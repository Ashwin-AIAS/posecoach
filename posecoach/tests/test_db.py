"""Schema smoke tests — SQLite in-memory, no real Postgres needed."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, WorkoutSession


async def test_tables_exist(test_db: AsyncSession) -> None:
    result = await test_db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'")
    )
    tables = [row[0] for row in result.fetchall()]
    assert "users" in tables
    assert "workout_sessions" in tables


async def test_insert_user(test_db: AsyncSession) -> None:
    user = User(email="alice@example.com", hashed_password="hashed_pw")
    test_db.add(user)
    await test_db.flush()

    result = await test_db.get(User, user.id)
    assert result is not None
    assert result.email == "alice@example.com"
    assert result.created_at is not None
    assert result.id


async def test_insert_workout_session(test_db: AsyncSession) -> None:
    user = User(email="bob@example.com", hashed_password="hashed_pw")
    test_db.add(user)
    await test_db.flush()

    workout = WorkoutSession(
        user_id=user.id,
        exercise="squat",
        rep_count=10,
        avg_form_score=85.5,
        keypoints_data={"frames": []},
    )
    test_db.add(workout)
    await test_db.flush()

    result = await test_db.get(WorkoutSession, workout.id)
    assert result is not None
    assert result.exercise == "squat"
    assert result.rep_count == 10
    assert abs(result.avg_form_score - 85.5) < 0.01
    assert result.ended_at is None


async def test_cascade_delete(test_db: AsyncSession) -> None:
    user = User(email="carol@example.com", hashed_password="hashed_pw")
    test_db.add(user)
    await test_db.flush()

    workout = WorkoutSession(user_id=user.id, exercise="deadlift", keypoints_data={})
    test_db.add(workout)
    await test_db.flush()
    workout_id = workout.id

    await test_db.delete(user)
    await test_db.flush()

    assert await test_db.get(WorkoutSession, workout_id) is None


async def test_email_unique_constraint(test_db: AsyncSession) -> None:
    user1 = User(email="dave@example.com", hashed_password="pw1")
    test_db.add(user1)
    await test_db.flush()

    user2 = User(email="dave@example.com", hashed_password="pw2")
    test_db.add(user2)
    try:
        await test_db.flush()
        assert False, "expected IntegrityError"
    except IntegrityError:
        await test_db.rollback()


async def test_query_sessions_by_user(test_db: AsyncSession) -> None:
    user = User(email="eve@example.com", hashed_password="hashed_pw")
    test_db.add(user)
    await test_db.flush()

    for exercise in ("squat", "lunge", "plank"):
        test_db.add(WorkoutSession(user_id=user.id, exercise=exercise, keypoints_data={}))
    await test_db.flush()

    rows = (
        await test_db.execute(
            text("SELECT id FROM workout_sessions WHERE user_id = :uid"),
            {"uid": user.id},
        )
    ).fetchall()
    assert len(rows) == 3
