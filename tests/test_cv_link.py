"""CV-link + routine-delete API tests (P26) — SQLite in-memory.

Covers the ``POST /sets/{id}/cv-link`` endpoint: the form score is copied
server-side from the caller's own ``WorkoutSession`` (never client-supplied),
foreign ids 404 in both directions (set and session), posing sessions are
rejected, and detach clears both linkage fields. Plus ``DELETE /routines/{id}``
with its IDOR check.
"""
from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, WorkoutSession

WORKOUTS = "/api/v1/workouts"


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


@pytest_asyncio.fixture
async def squat(test_db: AsyncSession) -> Exercise:
    """Seed one CV-supported catalog exercise."""
    ex = Exercise(
        slug="barbell-squat",
        name="Barbell Squat",
        category="strength",
        equipment="barbell",
        primary_muscles=["quadriceps"],
        secondary_muscles=["glutes"],
        instructions=["Squat."],
        image_urls=[],
        youtube_id="CWl0apMgshk",
        is_cv_supported=True,
    )
    test_db.add(ex)
    await test_db.commit()
    return ex


async def _make_set(client: AsyncClient, exercise_id: str) -> str:
    """Create workout → add exercise → add one set; return the set id."""
    workout = (await client.post(f"{WORKOUTS}/workouts", json={"title": "Legs"})).json()["id"]
    le = (
        await client.post(
            f"{WORKOUTS}/workouts/{workout}/exercises", json={"exercise_id": exercise_id}
        )
    ).json()["id"]
    created = await client.post(
        f"{WORKOUTS}/logged-exercises/{le}/sets", json={"weight_kg": 100, "reps": 5}
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _make_session(
    db: AsyncSession,
    user_id: str,
    *,
    score: float = 87.5,
    reps: int = 8,
    session_type: str = "exercise",
) -> str:
    """Insert a finished CV session row directly (the WS normally writes these)."""
    row = WorkoutSession(
        user_id=user_id,
        exercise="squat",
        session_type=session_type,
        rep_count=reps,
        avg_form_score=score,
        keypoints_data={"snapshots": []},
    )
    db.add(row)
    await db.commit()
    return row.id


# ── cv-link ───────────────────────────────────────────────────────────────────


async def test_cv_link_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(f"{WORKOUTS}/sets/some-id/cv-link", json={"session_id": "x"})
    assert resp.status_code == 401


async def test_cv_link_copies_score_and_reps_from_session(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    user_id = await _register(client, "linker@x.com")
    set_id = await _make_set(client, squat.id)
    session_id = await _make_session(test_db, user_id, score=87.5, reps=8)

    resp = await client.post(f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": session_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["form_score"] == 87.5
    assert body["source_session_id"] == session_id
    assert body["session_rep_count"] == 8

    # The link persists — visible on a plain set read-back via the workout.
    workouts = (await client.get(f"{WORKOUTS}/workouts")).json()
    detail = (await client.get(f"{WORKOUTS}/workouts/{workouts[0]['id']}")).json()
    stored = detail["exercises"][0]["sets"][0]
    assert stored["form_score"] == 87.5
    assert stored["source_session_id"] == session_id


async def test_cv_link_ignores_client_supplied_score(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    """Extra request fields must not override the server-side score copy."""
    user_id = await _register(client, "spoof@x.com")
    set_id = await _make_set(client, squat.id)
    session_id = await _make_session(test_db, user_id, score=42.0)

    resp = await client.post(
        f"{WORKOUTS}/sets/{set_id}/cv-link",
        json={"session_id": session_id, "form_score": 100.0},
    )
    assert resp.status_code == 200
    assert resp.json()["form_score"] == 42.0


async def test_cv_link_foreign_session_404(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    """User B's session id must be indistinguishable from a missing one."""
    other_id = await _register(client, "other@x.com")
    foreign_session = await _make_session(test_db, other_id)

    await _register(client, "me@x.com")  # cookie now belongs to the second user
    set_id = await _make_set(client, squat.id)

    resp = await client.post(
        f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": foreign_session}
    )
    assert resp.status_code == 404


async def test_cv_link_foreign_set_404(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    await _register(client, "victim@x.com")
    victim_set = await _make_set(client, squat.id)

    attacker_id = await _register(client, "attacker@x.com")
    own_session = await _make_session(test_db, attacker_id)

    resp = await client.post(
        f"{WORKOUTS}/sets/{victim_set}/cv-link", json={"session_id": own_session}
    )
    assert resp.status_code == 404


async def test_cv_link_missing_session_404(client: AsyncClient, squat: Exercise) -> None:
    await _register(client, "missing@x.com")
    set_id = await _make_set(client, squat.id)
    resp = await client.post(f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": "nope"})
    assert resp.status_code == 404


async def test_cv_link_posing_session_422(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    user_id = await _register(client, "poser@x.com")
    set_id = await _make_set(client, squat.id)
    posing = await _make_session(test_db, user_id, session_type="posing")

    resp = await client.post(f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": posing})
    assert resp.status_code == 422


async def test_cv_link_detach_clears_both_fields(
    client: AsyncClient, test_db: AsyncSession, squat: Exercise
) -> None:
    user_id = await _register(client, "detach@x.com")
    set_id = await _make_set(client, squat.id)
    session_id = await _make_session(test_db, user_id)

    linked = await client.post(
        f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": session_id}
    )
    assert linked.json()["form_score"] is not None

    detached = await client.post(f"{WORKOUTS}/sets/{set_id}/cv-link", json={"session_id": None})
    assert detached.status_code == 200
    body = detached.json()
    assert body["form_score"] is None
    assert body["source_session_id"] is None
    assert body["session_rep_count"] is None


# ── routine delete ────────────────────────────────────────────────────────────


async def test_delete_routine(client: AsyncClient, squat: Exercise) -> None:
    await _register(client, "routines@x.com")
    routine_id = (
        await client.post(
            f"{WORKOUTS}/routines", json={"name": "Legs", "exercise_ids": [squat.id]}
        )
    ).json()["id"]

    resp = await client.delete(f"{WORKOUTS}/routines/{routine_id}")
    assert resp.status_code == 204
    assert (await client.get(f"{WORKOUTS}/routines")).json() == []


async def test_delete_routine_foreign_404(client: AsyncClient, squat: Exercise) -> None:
    await _register(client, "owner@x.com")
    routine_id = (
        await client.post(
            f"{WORKOUTS}/routines", json={"name": "Push", "exercise_ids": [squat.id]}
        )
    ).json()["id"]

    await _register(client, "thief@x.com")
    assert (await client.delete(f"{WORKOUTS}/routines/{routine_id}")).status_code == 404

    # Still there for the owner.
    login = await client.post(
        "/api/v1/auth/login", json={"email": "owner@x.com", "password": "password123"}
    )
    assert login.status_code == 200
    assert len((await client.get(f"{WORKOUTS}/routines")).json()) == 1
