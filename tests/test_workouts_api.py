"""Workouts API tests (P24) — SQLite in-memory, auth + IDOR + history math.

Covers: auth required, catalog browse/search/detail, the
create-workout → add-exercise → add-set → read-back flow, per-exercise history
aggregates, routines and from-routine, and IDOR (user B cannot touch user A's
workouts, sets, or routines).
"""
from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise

WORKOUTS = "/api/v1/workouts"


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


@pytest_asyncio.fixture
async def catalog(test_db: AsyncSession) -> dict[str, str]:
    """Seed two catalog exercises (one CV-supported) and return their ids/slugs."""
    squat = Exercise(
        slug="barbell-squat",
        name="Barbell Squat",
        category="strength",
        equipment="barbell",
        primary_muscles=["quadriceps"],
        secondary_muscles=["glutes", "hamstrings"],
        instructions=["Set up under the bar.", "Squat to depth, then stand."],
        image_urls=["https://cdn.example/Barbell_Squat/0.jpg"],
        youtube_id="CWl0apMgshk",
        is_cv_supported=True,
    )
    bench = Exercise(
        slug="bench-press",
        name="Bench Press",
        category="strength",
        equipment="barbell",
        primary_muscles=["chest"],
        secondary_muscles=["triceps"],
        is_cv_supported=False,
    )
    test_db.add_all([squat, bench])
    await test_db.commit()
    return {
        "squat_id": squat.id,
        "squat_slug": squat.slug,
        "bench_id": bench.id,
        "bench_slug": bench.slug,
    }


# ── Auth ──────────────────────────────────────────────────────────────────────


async def test_browse_exercises_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(f"{WORKOUTS}/exercises")
    assert resp.status_code == 401


async def test_create_workout_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(f"{WORKOUTS}/workouts", json={"title": "Leg day"})
    assert resp.status_code == 401


# ── Catalog ─────────────────────────────────────────────────────────────────-


async def test_browse_and_filter_catalog(client: AsyncClient, catalog: dict[str, str]) -> None:
    await _register(client, "browse@x.com")

    everything = await client.get(f"{WORKOUTS}/exercises")
    assert everything.status_code == 200
    slugs = {r["slug"] for r in everything.json()}
    assert {"barbell-squat", "bench-press"} <= slugs

    # name search
    searched = await client.get(f"{WORKOUTS}/exercises", params={"search": "squat"})
    assert [r["slug"] for r in searched.json()] == ["barbell-squat"]

    # muscle filter (matches JSON muscle lists)
    chest = await client.get(f"{WORKOUTS}/exercises", params={"muscle": "chest"})
    assert [r["slug"] for r in chest.json()] == ["bench-press"]

    # equipment filter
    barbell = await client.get(f"{WORKOUTS}/exercises", params={"equipment": "barbell"})
    assert {r["slug"] for r in barbell.json()} == {"barbell-squat", "bench-press"}


async def test_get_exercise_detail_and_404(client: AsyncClient, catalog: dict[str, str]) -> None:
    await _register(client, "detail@x.com")

    ok = await client.get(f"{WORKOUTS}/exercises/barbell-squat")
    assert ok.status_code == 200
    body = ok.json()
    assert body["is_cv_supported"] is True
    assert body["youtube_id"] == "CWl0apMgshk"

    missing = await client.get(f"{WORKOUTS}/exercises/does-not-exist")
    assert missing.status_code == 404


# ── Workout lifecycle ─────────────────────────────────────────────────────────


async def test_create_add_exercise_add_set_read_back(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "flow@x.com")

    created = await client.post(f"{WORKOUTS}/workouts", json={"title": "Leg day"})
    assert created.status_code == 201
    workout_id = created.json()["id"]
    assert created.json()["exercises"] == []

    added = await client.post(
        f"{WORKOUTS}/workouts/{workout_id}/exercises",
        json={"exercise_id": catalog["squat_id"]},
    )
    assert added.status_code == 201
    le_id = added.json()["id"]
    assert added.json()["order"] == 0
    assert added.json()["exercise"]["slug"] == "barbell-squat"

    s1 = await client.post(
        f"{WORKOUTS}/logged-exercises/{le_id}/sets",
        json={"weight_kg": 100.0, "reps": 5},
    )
    assert s1.status_code == 201
    assert s1.json()["set_number"] == 1
    assert s1.json()["form_score"] is None  # CV link filled in P26
    assert s1.json()["source_session_id"] is None

    s2 = await client.post(
        f"{WORKOUTS}/logged-exercises/{le_id}/sets",
        json={"weight_kg": 100.0, "reps": 5, "rpe": 8.0},
    )
    assert s2.json()["set_number"] == 2  # auto-incremented

    # Read back the assembled workout.
    full = await client.get(f"{WORKOUTS}/workouts/{workout_id}")
    assert full.status_code == 200
    body = full.json()
    assert len(body["exercises"]) == 1
    sets = body["exercises"][0]["sets"]
    assert [s["set_number"] for s in sets] == [1, 2]
    assert sets[1]["rpe"] == 8.0


async def test_patch_and_delete_workout(client: AsyncClient, catalog: dict[str, str]) -> None:
    await _register(client, "edit@x.com")
    workout_id = (await client.post(f"{WORKOUTS}/workouts", json={"title": "Tmp"})).json()["id"]

    patched = await client.patch(
        f"{WORKOUTS}/workouts/{workout_id}", json={"title": "Renamed", "notes": "felt strong"}
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"
    assert patched.json()["notes"] == "felt strong"

    deleted = await client.delete(f"{WORKOUTS}/workouts/{workout_id}")
    assert deleted.status_code == 204
    assert (await client.get(f"{WORKOUTS}/workouts/{workout_id}")).status_code == 404


async def test_deleting_workout_cascades_to_sets(
    client: AsyncClient, catalog: dict[str, str], test_db: AsyncSession
) -> None:
    from sqlalchemy import func, select

    from app.models import LoggedExercise, LoggedSet

    await _register(client, "cascade@x.com")
    workout_id = (await client.post(f"{WORKOUTS}/workouts", json={"title": "X"})).json()["id"]
    le_id = (
        await client.post(
            f"{WORKOUTS}/workouts/{workout_id}/exercises",
            json={"exercise_id": catalog["squat_id"]},
        )
    ).json()["id"]
    await client.post(f"{WORKOUTS}/logged-exercises/{le_id}/sets", json={"weight_kg": 60, "reps": 8})

    await client.delete(f"{WORKOUTS}/workouts/{workout_id}")

    async def count(model: type) -> int:
        return (await test_db.execute(select(func.count()).select_from(model))).scalar_one()

    assert await count(LoggedExercise) == 0
    assert await count(LoggedSet) == 0
    assert await count(Exercise) == 2  # shared catalog survives


# ── Per-exercise history ──────────────────────────────────────────────────────


async def test_exercise_history_aggregates_volume_and_best_1rm(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "hist@x.com")
    workout_id = (await client.post(f"{WORKOUTS}/workouts", json={"title": "X"})).json()["id"]
    le_id = (
        await client.post(
            f"{WORKOUTS}/workouts/{workout_id}/exercises",
            json={"exercise_id": catalog["squat_id"]},
        )
    ).json()["id"]
    await client.post(f"{WORKOUTS}/logged-exercises/{le_id}/sets", json={"weight_kg": 100, "reps": 5})
    await client.post(f"{WORKOUTS}/logged-exercises/{le_id}/sets", json={"weight_kg": 110, "reps": 3})

    hist = await client.get(f"{WORKOUTS}/exercises/barbell-squat/history")
    assert hist.status_code == 200
    body = hist.json()
    assert body["total_sets"] == 2
    assert body["total_volume_kg"] == 100 * 5 + 110 * 3  # 830
    # best 1RM = max(100*(1+5/30), 110*(1+3/30)) = max(116.67, 121.0) = 121.0
    assert body["best_one_rep_max"] == 121.0


async def test_exercise_history_empty_for_untrained_exercise(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "empty@x.com")
    hist = await client.get(f"{WORKOUTS}/exercises/bench-press/history")
    assert hist.status_code == 200
    assert hist.json() == {
        "slug": "bench-press",
        "name": "Bench Press",
        "total_sets": 0,
        "total_volume_kg": 0.0,
        "best_one_rep_max": 0.0,
        "entries": [],
    }


# ── Routines ──────────────────────────────────────────────────────────────────


async def test_create_routine_and_start_workout_from_it(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "routine@x.com")

    created = await client.post(
        f"{WORKOUTS}/routines",
        json={"name": "Push", "exercise_ids": [catalog["bench_id"], catalog["squat_id"]]},
    )
    assert created.status_code == 201
    routine_id = created.json()["id"]
    assert [e["order"] for e in created.json()["exercises"]] == [0, 1]
    assert created.json()["exercises"][0]["exercise"]["slug"] == "bench-press"

    listed = await client.get(f"{WORKOUTS}/routines")
    assert [r["id"] for r in listed.json()] == [routine_id]

    from_routine = await client.post(f"{WORKOUTS}/workouts/from-routine/{routine_id}")
    assert from_routine.status_code == 201
    body = from_routine.json()
    assert body["title"] == "Push"
    assert [e["exercise"]["slug"] for e in body["exercises"]] == ["bench-press", "barbell-squat"]
    assert all(e["sets"] == [] for e in body["exercises"])


async def test_create_routine_with_unknown_exercise_is_422(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "badroutine@x.com")
    resp = await client.post(
        f"{WORKOUTS}/routines",
        json={"name": "Bad", "exercise_ids": [catalog["squat_id"], "nope-not-real"]},
    )
    assert resp.status_code == 422


# ── IDOR — user B must not touch user A's resources ──────────────────────────-


async def test_idor_workouts_sets_and_routines(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    # User A creates a workout with an exercise + set, and a routine.
    await _register(client, "alice@x.com")
    a_workout = (await client.post(f"{WORKOUTS}/workouts", json={"title": "A"})).json()["id"]
    a_le = (
        await client.post(
            f"{WORKOUTS}/workouts/{a_workout}/exercises",
            json={"exercise_id": catalog["squat_id"]},
        )
    ).json()["id"]
    a_set = (
        await client.post(
            f"{WORKOUTS}/logged-exercises/{a_le}/sets", json={"weight_kg": 100, "reps": 5}
        )
    ).json()["id"]
    a_routine = (
        await client.post(
            f"{WORKOUTS}/routines", json={"name": "A", "exercise_ids": [catalog["squat_id"]]}
        )
    ).json()["id"]

    # User B registers on the same client (cookie now belongs to B).
    await _register(client, "bob@x.com")

    assert (await client.get(f"{WORKOUTS}/workouts/{a_workout}")).status_code == 404
    assert (
        await client.patch(f"{WORKOUTS}/workouts/{a_workout}", json={"title": "hijack"})
    ).status_code == 404
    assert (await client.delete(f"{WORKOUTS}/workouts/{a_workout}")).status_code == 404
    assert (
        await client.post(
            f"{WORKOUTS}/workouts/{a_workout}/exercises",
            json={"exercise_id": catalog["squat_id"]},
        )
    ).status_code == 404
    assert (
        await client.post(
            f"{WORKOUTS}/logged-exercises/{a_le}/sets", json={"weight_kg": 1, "reps": 1}
        )
    ).status_code == 404
    assert (
        await client.patch(f"{WORKOUTS}/sets/{a_set}", json={"reps": 99})
    ).status_code == 404
    assert (await client.delete(f"{WORKOUTS}/sets/{a_set}")).status_code == 404
    assert (
        await client.post(f"{WORKOUTS}/workouts/from-routine/{a_routine}")
    ).status_code == 404

    # And B sees none of A's workouts/routines in their own lists.
    assert (await client.get(f"{WORKOUTS}/workouts")).json() == []
    assert (await client.get(f"{WORKOUTS}/routines")).json() == []


# ── Custom exercises (P29) ─────────────────────────────────────────────────────


async def test_create_custom_exercise_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(f"{WORKOUTS}/exercises", json={"name": "Cable Face Pull Variant"})
    assert resp.status_code == 401


async def test_create_custom_exercise_appears_in_own_catalog(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "custom@x.com")

    created = await client.post(
        f"{WORKOUTS}/exercises",
        json={"name": "Cable Face Pull Variant", "primary_muscle": "shoulders"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["is_custom"] is True
    assert body["slug"].startswith("custom-")
    assert body["primary_muscles"] == ["shoulders"]

    listed = await client.get(f"{WORKOUTS}/exercises")
    slugs = {r["slug"] for r in listed.json()}
    # Seeded catalog rows are still there alongside the new custom one.
    assert {"barbell-squat", "bench-press", body["slug"]} <= slugs

    detail = await client.get(f"{WORKOUTS}/exercises/{body['slug']}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "Cable Face Pull Variant"


async def test_custom_exercise_isolated_between_users(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "owner@x.com")
    created = await client.post(f"{WORKOUTS}/exercises", json={"name": "Owner's Curl"})
    slug = created.json()["slug"]
    ex_id = created.json()["id"]

    # A different user registers on the same client (cookie now belongs to them).
    await _register(client, "stranger@x.com")

    # Not in the stranger's catalog listing.
    listed = await client.get(f"{WORKOUTS}/exercises")
    assert slug not in {r["slug"] for r in listed.json()}

    # Not resolvable by slug — 404, indistinguishable from a missing exercise.
    assert (await client.get(f"{WORKOUTS}/exercises/{slug}")).status_code == 404

    # Can't attach it to their own workout by raw exercise id either.
    workout_id = (await client.post(f"{WORKOUTS}/workouts", json={"title": "X"})).json()["id"]
    add = await client.post(
        f"{WORKOUTS}/workouts/{workout_id}/exercises", json={"exercise_id": ex_id}
    )
    assert add.status_code == 404

    # Nor via a routine.
    bad_routine = await client.post(
        f"{WORKOUTS}/routines", json={"name": "Bad", "exercise_ids": [ex_id]}
    )
    assert bad_routine.status_code == 422


async def test_log_sets_against_custom_exercise(
    client: AsyncClient, catalog: dict[str, str]
) -> None:
    await _register(client, "logcustom@x.com")
    ex = (
        await client.post(f"{WORKOUTS}/exercises", json={"name": "Landmine Twist"})
    ).json()

    workout_id = (await client.post(f"{WORKOUTS}/workouts", json={"title": "Core"})).json()["id"]
    added = await client.post(
        f"{WORKOUTS}/workouts/{workout_id}/exercises", json={"exercise_id": ex["id"]}
    )
    assert added.status_code == 201
    le_id = added.json()["id"]
    assert added.json()["exercise"]["slug"] == ex["slug"]

    s1 = await client.post(
        f"{WORKOUTS}/logged-exercises/{le_id}/sets", json={"weight_kg": 20.0, "reps": 12}
    )
    assert s1.status_code == 201

    full = await client.get(f"{WORKOUTS}/workouts/{workout_id}")
    assert full.json()["exercises"][0]["sets"][0]["reps"] == 12

    hist = await client.get(f"{WORKOUTS}/exercises/{ex['slug']}/history")
    assert hist.status_code == 200
    assert hist.json()["total_sets"] == 1
