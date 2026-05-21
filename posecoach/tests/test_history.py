"""History endpoint tests — list, detail, GDPR delete, IDOR protection."""
from __future__ import annotations

from datetime import datetime, timezone

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
