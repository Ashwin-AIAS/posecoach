"""Integration tests for the database schema — requires a real PostgreSQL DB.

These tests verify that `alembic upgrade head` produces a schema that matches
the SQLAlchemy ORM models and enforces the expected constraints.

No mocking — every assertion hits the real test database.
"""
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import User, WorkoutSession


async def test_tables_exist(test_engine: AsyncEngine) -> None:
    """Migrations must create both expected tables."""
    async with test_engine.connect() as conn:
        tables: list[str] = await conn.run_sync(
            lambda c: inspect(c).get_table_names()
        )
    assert "users" in tables
    assert "workout_sessions" in tables


async def test_insert_user(db_session: AsyncSession) -> None:
    """Can write a User row and read it back with all fields intact."""
    user = User(email="alice@example.com", hashed_password="hashed_pw")
    db_session.add(user)
    await db_session.flush()

    result = await db_session.get(User, user.id)
    assert result is not None
    assert result.email == "alice@example.com"
    assert result.created_at is not None
    assert result.id  # UUID was auto-generated


async def test_insert_workout_session(db_session: AsyncSession) -> None:
    """Can write a WorkoutSession linked to a User via FK."""
    user = User(email="bob@example.com", hashed_password="hashed_pw")
    db_session.add(user)
    await db_session.flush()

    workout = WorkoutSession(
        user_id=user.id,
        exercise="squat",
        rep_count=10,
        avg_form_score=85.5,
        keypoints_data={"frames": []},
    )
    db_session.add(workout)
    await db_session.flush()

    result = await db_session.get(WorkoutSession, workout.id)
    assert result is not None
    assert result.exercise == "squat"
    assert result.rep_count == 10
    assert result.avg_form_score == pytest.approx(85.5)
    assert result.ended_at is None


async def test_cascade_delete(db_session: AsyncSession) -> None:
    """Deleting a User must cascade-delete their WorkoutSessions."""
    user = User(email="carol@example.com", hashed_password="hashed_pw")
    db_session.add(user)
    await db_session.flush()

    workout = WorkoutSession(user_id=user.id, exercise="deadlift", keypoints_data={})
    db_session.add(workout)
    await db_session.flush()
    workout_id = workout.id

    await db_session.delete(user)
    await db_session.flush()

    assert await db_session.get(WorkoutSession, workout_id) is None


async def test_email_unique_constraint(db_session: AsyncSession) -> None:
    """Inserting a duplicate email must raise IntegrityError."""
    user1 = User(email="dave@example.com", hashed_password="pw1")
    db_session.add(user1)
    await db_session.flush()

    user2 = User(email="dave@example.com", hashed_password="pw2")
    db_session.add(user2)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_query_sessions_by_user(db_session: AsyncSession) -> None:
    """Can filter WorkoutSessions by user_id."""
    user = User(email="eve@example.com", hashed_password="hashed_pw")
    db_session.add(user)
    await db_session.flush()

    for exercise in ("squat", "lunge", "plank"):
        db_session.add(
            WorkoutSession(user_id=user.id, exercise=exercise, keypoints_data={})
        )
    await db_session.flush()

    rows = (
        await db_session.execute(
            text("SELECT id FROM workout_sessions WHERE user_id = :uid"),
            {"uid": user.id},
        )
    ).fetchall()
    assert len(rows) == 3
