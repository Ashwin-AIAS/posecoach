"""History endpoint tests — list, detail, GDPR delete, IDOR protection, P16 feedback."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, WorkoutSession


async def _register_and_get_user_id(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    return resp.json()["id"]


@pytest_asyncio.fixture
async def seeded_user(client: AsyncClient, test_db: AsyncSession) -> str:
    """Register a user and seed two sessions belonging to them."""
    uid = await _register_and_get_user_id(client, "owner@x.com")
    test_db.add_all(
        [
            WorkoutSession(
                user_id=uid,
                exercise="squat",
                rep_count=10,
                avg_form_score=82.5,
                keypoints_data={"snapshots": [{"ts": 1.0, "score": 80, "kp": []}]},
                started_at=datetime.now(timezone.utc),
            ),
            WorkoutSession(
                user_id=uid,
                exercise="deadlift",
                rep_count=8,
                avg_form_score=75.0,
                keypoints_data={"snapshots": []},
                started_at=datetime.now(timezone.utc),
            ),
        ]
    )
    await test_db.commit()
    return uid


async def test_list_sessions_returns_only_caller_sessions(
    client: AsyncClient, seeded_user: str, test_db: AsyncSession
) -> None:
    # Seed a session belonging to a different user
    other = User(email="other@x.com", hashed_password="x")
    test_db.add(other)
    await test_db.flush()
    test_db.add(
        WorkoutSession(
            user_id=other.id,
            exercise="bench",
            rep_count=5,
            avg_form_score=90.0,
            keypoints_data={"snapshots": []},
            started_at=datetime.now(timezone.utc),
        )
    )
    await test_db.commit()

    resp = await client.get("/api/v1/history/sessions")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    exercises = {r["exercise"] for r in rows}
    assert exercises == {"squat", "deadlift"}
    assert "bench" not in exercises


async def test_list_sessions_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/history/sessions")
    assert resp.status_code == 401


async def test_exercise_sessions_report_exercise_session_type(
    client: AsyncClient, seeded_user: str
) -> None:
    """Seeded sessions default to session_type='exercise' (P16 backfill default)."""
    resp = await client.get("/api/v1/history/sessions")
    assert resp.status_code == 200
    assert {r["session_type"] for r in resp.json()} == {"exercise"}


async def test_posing_session_persists_and_is_retrievable(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    """P16: a posing session persists with session_type='posing' and is listed."""
    uid = await _register_and_get_user_id(client, "poser@x.com")
    test_db.add(
        WorkoutSession(
            user_id=uid,
            exercise="front_double_biceps",
            session_type="posing",
            rep_count=0,
            avg_form_score=88.0,
            keypoints_data={"snapshots": [{"ts": 1.0, "score": 88, "kp": []}]},
            started_at=datetime.now(timezone.utc),
        )
    )
    await test_db.commit()

    listing = await client.get("/api/v1/history/sessions")
    posing = [r for r in listing.json() if r["session_type"] == "posing"]
    assert len(posing) == 1
    assert posing[0]["exercise"] == "front_double_biceps"

    detail = await client.get(f"/api/v1/history/sessions/{posing[0]['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["session_type"] == "posing"
    assert "snapshots" in body["keypoints_data"]


async def test_get_session_detail_includes_keypoints(
    client: AsyncClient, seeded_user: str, test_db: AsyncSession
) -> None:
    listing = await client.get("/api/v1/history/sessions")
    sid = next(r["id"] for r in listing.json() if r["exercise"] == "squat")

    resp = await client.get(f"/api/v1/history/sessions/{sid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["exercise"] == "squat"
    assert "snapshots" in body["keypoints_data"]


async def test_get_other_users_session_returns_404(
    client: AsyncClient, seeded_user: str, test_db: AsyncSession
) -> None:
    # Create another user's session
    other = User(email="other2@x.com", hashed_password="x")
    test_db.add(other)
    await test_db.flush()
    other_session = WorkoutSession(
        user_id=other.id,
        exercise="bench",
        rep_count=5,
        avg_form_score=90.0,
        keypoints_data={"snapshots": []},
        started_at=datetime.now(timezone.utc),
    )
    test_db.add(other_session)
    await test_db.commit()

    resp = await client.get(f"/api/v1/history/sessions/{other_session.id}")
    assert resp.status_code == 404  # IDOR protection — 404 not 403 to avoid leaking existence


async def test_delete_session_removes_it(
    client: AsyncClient, seeded_user: str
) -> None:
    listing = await client.get("/api/v1/history/sessions")
    sid = listing.json()[0]["id"]
    resp = await client.delete(f"/api/v1/history/sessions/{sid}")
    assert resp.status_code == 204
    after = await client.get("/api/v1/history/sessions")
    assert sid not in {r["id"] for r in after.json()}


async def test_delete_other_users_session_returns_404(
    client: AsyncClient, seeded_user: str, test_db: AsyncSession
) -> None:
    other = User(email="other3@x.com", hashed_password="x")
    test_db.add(other)
    await test_db.flush()
    other_session = WorkoutSession(
        user_id=other.id,
        exercise="curl",
        rep_count=3,
        avg_form_score=70.0,
        keypoints_data={"snapshots": []},
        started_at=datetime.now(timezone.utc),
    )
    test_db.add(other_session)
    await test_db.commit()

    resp = await client.delete(f"/api/v1/history/sessions/{other_session.id}")
    assert resp.status_code == 404


# ── P16: effort feedback ──────────────────────────────────────────────────────


async def test_feedback_saves_and_overwrites_effort(
    client: AsyncClient, seeded_user: str
) -> None:
    listing = await client.get("/api/v1/history/sessions")
    sid = listing.json()[0]["id"]

    resp = await client.patch(
        f"/api/v1/history/sessions/{sid}/feedback", json={"effort": 3}
    )
    assert resp.status_code == 200
    assert resp.json()["effort_rating"] == 3

    # Idempotent — overwriting an existing rating is fine
    resp2 = await client.patch(
        f"/api/v1/history/sessions/{sid}/feedback", json={"effort": 5}
    )
    assert resp2.status_code == 200
    assert resp2.json()["effort_rating"] == 5


@pytest.mark.parametrize("effort", [0, 6])
async def test_feedback_out_of_range_effort_returns_422(
    client: AsyncClient, seeded_user: str, effort: int
) -> None:
    listing = await client.get("/api/v1/history/sessions")
    sid = listing.json()[0]["id"]
    resp = await client.patch(
        f"/api/v1/history/sessions/{sid}/feedback", json={"effort": effort}
    )
    assert resp.status_code == 422


async def test_feedback_other_users_session_returns_404(
    client: AsyncClient, seeded_user: str, test_db: AsyncSession
) -> None:
    other = User(email="other4@x.com", hashed_password="x")
    test_db.add(other)
    await test_db.flush()
    other_session = WorkoutSession(
        user_id=other.id,
        exercise="squat",
        rep_count=5,
        avg_form_score=90.0,
        keypoints_data={"snapshots": []},
        started_at=datetime.now(timezone.utc),
    )
    test_db.add(other_session)
    await test_db.commit()

    resp = await client.patch(
        f"/api/v1/history/sessions/{other_session.id}/feedback", json={"effort": 3}
    )
    assert resp.status_code == 404


# ── P16: recommendation ───────────────────────────────────────────────────────


def _completed_session(
    uid: str, score: float, effort: int | None, hours_ago: int
) -> WorkoutSession:
    started = datetime.now(timezone.utc) - timedelta(hours=hours_ago + 1)
    return WorkoutSession(
        user_id=uid,
        exercise="squat",
        rep_count=10,
        avg_form_score=score,
        effort_rating=effort,
        keypoints_data={"snapshots": []},
        started_at=started,
        ended_at=started + timedelta(minutes=10),
    )


async def test_recommendation_returns_200_with_enough_history(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    uid = await _register_and_get_user_id(client, "rec@x.com")
    test_db.add_all(
        [
            _completed_session(uid, score=90.0, effort=1, hours_ago=0),
            _completed_session(uid, score=80.0, effort=3, hours_ago=24),
        ]
    )
    await test_db.commit()

    resp = await client.get("/api/v1/history/recommendation?exercise=squat")
    assert resp.status_code == 200
    body = resp.json()
    assert body["exercise"] == "squat"
    assert body["rep_target_delta"] == 2  # easy effort + strong form → progress
    assert body["message"]


async def test_recommendation_cold_start_returns_204(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    uid = await _register_and_get_user_id(client, "cold@x.com")
    test_db.add(_completed_session(uid, score=80.0, effort=3, hours_ago=0))
    await test_db.commit()

    resp = await client.get("/api/v1/history/recommendation?exercise=squat")
    assert resp.status_code == 204


async def test_recommendation_unknown_exercise_returns_422(
    client: AsyncClient, seeded_user: str
) -> None:
    resp = await client.get("/api/v1/history/recommendation?exercise=yoga")
    assert resp.status_code == 422


async def test_recommendation_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/history/recommendation?exercise=squat")
    assert resp.status_code == 401
