"""Query + computation helpers for the workout-logger API (P24).

The pure 1RM helper is deterministic (unit-tested); the async helpers run the
catalog search and per-exercise history queries. Every per-user query is scoped
by ``user_id`` (IDOR rule).
"""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, LoggedExercise, LoggedSet, WorkoutLog
from app.workouts.schemas import ExerciseHistoryOut, SetHistoryEntry

# Epley one-rep-max coefficient: 1RM = weight * (1 + reps / 30).
EPLEY_REP_DIVISOR: float = 30.0


def one_rep_max(weight_kg: float, reps: int) -> float:
    """Estimate a one-rep max via the Epley formula (deterministic).

    Args:
        weight_kg: Weight lifted, in kilograms.
        reps: Repetitions performed (``0`` yields the bare weight).

    Returns:
        Estimated 1RM in kilograms: ``weight_kg * (1 + reps / 30)``.
    """
    return weight_kg * (1.0 + reps / EPLEY_REP_DIVISOR)


async def search_catalog(
    db: AsyncSession,
    *,
    search: str | None = None,
    muscle: str | None = None,
    equipment: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Exercise]:
    """Browse the shared exercise catalog with optional filters.

    Name/slug ``search`` and ``equipment`` are filtered in SQL; ``muscle`` is
    matched in Python against the JSON muscle lists (portable across SQLite and
    Postgres) before ``offset``/``limit`` paginate the result.
    """
    stmt = select(Exercise).order_by(Exercise.name.asc())
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Exercise.name).like(pattern),
                func.lower(Exercise.slug).like(pattern),
            )
        )
    if equipment:
        stmt = stmt.where(func.lower(Exercise.equipment) == equipment.strip().lower())

    rows = list((await db.execute(stmt)).scalars().all())
    if muscle:
        target = muscle.strip().lower()
        rows = [
            r
            for r in rows
            if target in {m.lower() for m in r.primary_muscles}
            or target in {m.lower() for m in r.secondary_muscles}
        ]
    return rows[offset : offset + limit]


async def get_exercise_history(
    db: AsyncSession, *, user_id: str, exercise: Exercise
) -> ExerciseHistoryOut:
    """Aggregate the caller's past sets of one exercise (volume + best 1RM)."""
    stmt = (
        select(LoggedSet, WorkoutLog)
        .join(LoggedExercise, LoggedSet.logged_exercise_id == LoggedExercise.id)
        .join(WorkoutLog, LoggedExercise.workout_log_id == WorkoutLog.id)
        .where(WorkoutLog.user_id == user_id, LoggedExercise.exercise_id == exercise.id)
        .order_by(WorkoutLog.started_at.desc(), LoggedSet.set_number.asc())
    )
    rows = (await db.execute(stmt)).all()

    entries = [
        SetHistoryEntry(
            workout_id=workout.id,
            performed_at=workout.started_at,
            weight_kg=logged_set.weight_kg,
            reps=logged_set.reps,
            est_one_rep_max=round(one_rep_max(logged_set.weight_kg, logged_set.reps), 2),
        )
        for logged_set, workout in rows
    ]
    total_volume = sum((s.weight_kg * s.reps for s, _ in rows), 0.0)
    best = max((one_rep_max(s.weight_kg, s.reps) for s, _ in rows), default=0.0)

    return ExerciseHistoryOut(
        slug=exercise.slug,
        name=exercise.name,
        total_sets=len(entries),
        total_volume_kg=round(total_volume, 2),
        best_one_rep_max=round(best, 2),
        entries=entries,
    )
