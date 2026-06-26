"""P24 workout-logger model tests — additive schema, SQLite in-memory.

Uses a dedicated FK-enforcing engine (``PRAGMA foreign_keys=ON``) so the
``ondelete=CASCADE`` and ``ondelete=SET NULL`` behaviour is actually exercised —
the shared conftest engine leaves SQLite foreign-key enforcement off.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

import pytest_asyncio
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.db import Base
from app.models import (
    Exercise,
    LoggedExercise,
    LoggedSet,
    User,
    WorkoutLog,
    WorkoutSession,
)


@pytest_asyncio.fixture
async def fk_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_fk(dbapi_conn: Any, _record: Any) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def _make_user(session: AsyncSession) -> User:
    user = User(email="lifter@example.com", hashed_password="x")
    session.add(user)
    await session.flush()
    return user


async def _make_exercise(session: AsyncSession) -> Exercise:
    ex = Exercise(slug="barbell-back-squat", name="Barbell Back Squat", is_cv_supported=True)
    session.add(ex)
    await session.flush()
    return ex


async def _make_logged_exercise(
    session: AsyncSession, user: User, ex: Exercise, title: str
) -> LoggedExercise:
    log = WorkoutLog(user_id=user.id, title=title)
    session.add(log)
    await session.flush()
    le = LoggedExercise(workout_log_id=log.id, exercise_id=ex.id, order=0)
    session.add(le)
    await session.flush()
    return le


async def test_workout_with_exercises_and_sets(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    ex = await _make_exercise(fk_session)
    le = await _make_logged_exercise(fk_session, user, ex, "Leg day")

    fk_session.add_all(
        [
            LoggedSet(logged_exercise_id=le.id, set_number=1, weight_kg=100.0, reps=5),
            LoggedSet(logged_exercise_id=le.id, set_number=2, weight_kg=100.0, reps=5, rpe=8.0),
        ]
    )
    await fk_session.commit()

    loaded = (
        await fk_session.execute(
            select(WorkoutLog)
            .where(WorkoutLog.id == le.workout_log_id)
            .options(selectinload(WorkoutLog.exercises).selectinload(LoggedExercise.sets))
        )
    ).scalar_one()

    assert len(loaded.exercises) == 1
    sets = loaded.exercises[0].sets
    assert len(sets) == 2
    assert sets[0].weight_kg == 100.0
    assert sets[0].reps == 5
    assert sets[0].rpe is None  # unset → nullable default
    assert sets[0].completed is True  # default
    assert sets[0].is_warmup is False  # default
    assert sets[1].rpe == 8.0


async def test_deleting_workout_cascades_to_exercises_and_sets(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    ex = await _make_exercise(fk_session)
    le = await _make_logged_exercise(fk_session, user, ex, "Push day")
    fk_session.add(LoggedSet(logged_exercise_id=le.id, set_number=1, weight_kg=60.0, reps=8))
    await fk_session.commit()

    loaded = (
        await fk_session.execute(
            select(WorkoutLog)
            .where(WorkoutLog.id == le.workout_log_id)
            .options(selectinload(WorkoutLog.exercises).selectinload(LoggedExercise.sets))
        )
    ).scalar_one()
    await fk_session.delete(loaded)
    await fk_session.commit()

    async def count(model: type[Any]) -> int:
        return (
            await fk_session.execute(select(func.count()).select_from(model))
        ).scalar_one()

    assert await count(WorkoutLog) == 0
    assert await count(LoggedExercise) == 0
    assert await count(LoggedSet) == 0
    # The shared catalog row survives — cascade is scoped to the workout graph.
    assert await count(Exercise) == 1


async def test_logged_set_source_session_nullable_and_set_null_on_delete(
    fk_session: AsyncSession,
) -> None:
    user = await _make_user(fk_session)
    ex = await _make_exercise(fk_session)
    le = await _make_logged_exercise(fk_session, user, ex, "CV-linked")

    cv_session = WorkoutSession(
        user_id=user.id, exercise="squat", rep_count=5, avg_form_score=88.0
    )
    fk_session.add(cv_session)
    await fk_session.flush()

    linked = LoggedSet(
        logged_exercise_id=le.id,
        set_number=1,
        weight_kg=100.0,
        reps=5,
        source_session_id=cv_session.id,
        form_score=88.0,
    )
    unlinked = LoggedSet(logged_exercise_id=le.id, set_number=2, weight_kg=100.0, reps=5)
    fk_session.add_all([linked, unlinked])
    await fk_session.commit()

    assert unlinked.source_session_id is None  # column is nullable
    assert linked.source_session_id == cv_session.id

    # Deleting the CV session nulls the link (ondelete=SET NULL) — the set stays.
    await fk_session.delete(cv_session)
    await fk_session.commit()
    await fk_session.refresh(linked)

    assert linked.source_session_id is None
    assert linked.form_score == 88.0
    remaining = (
        await fk_session.execute(select(func.count()).select_from(LoggedSet))
    ).scalar_one()
    assert remaining == 2
