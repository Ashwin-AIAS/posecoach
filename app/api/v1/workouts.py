"""Workout-logger routes (P24): catalog browse, workouts, sets, and routines.

Mirrors ``history.py``: ``get_current_user`` on every route, async handlers,
structlog. Every per-user query is filtered by ``user_id == current_user.id`` —
a lookup by resource id without that filter would be an IDOR vulnerability. For
nested resources (sets, logged exercises) ownership is enforced by joining up to
``workout_logs.user_id``; a foreign id returns 404 (not 403) so it is
indistinguishable from a missing one.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import (
    Exercise,
    LoggedExercise,
    LoggedSet,
    Routine,
    RoutineExercise,
    User,
    WorkoutLog,
)
from app.workouts.schemas import (
    AddExerciseRequest,
    ExerciseHistoryOut,
    ExerciseOut,
    LoggedExerciseOut,
    RoutineCreate,
    RoutineExerciseOut,
    RoutineOut,
    SetCreate,
    SetOut,
    SetUpdate,
    WorkoutCreate,
    WorkoutOut,
    WorkoutSummary,
    WorkoutUpdate,
)
from app.workouts.service import get_exercise_history, search_catalog

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"])


# ── Response mappers ──────────────────────────────────────────────────────────


def _exercise_out(ex: Exercise) -> ExerciseOut:
    return ExerciseOut(
        id=ex.id,
        slug=ex.slug,
        name=ex.name,
        category=ex.category,
        equipment=ex.equipment,
        primary_muscles=ex.primary_muscles,
        secondary_muscles=ex.secondary_muscles,
        instructions=ex.instructions,
        image_urls=ex.image_urls,
        youtube_id=ex.youtube_id,
        is_cv_supported=ex.is_cv_supported,
    )


def _set_out(s: LoggedSet) -> SetOut:
    return SetOut(
        id=s.id,
        set_number=s.set_number,
        weight_kg=s.weight_kg,
        reps=s.reps,
        rpe=s.rpe,
        is_warmup=s.is_warmup,
        completed=s.completed,
        form_score=s.form_score,
        source_session_id=s.source_session_id,
    )


def _logged_exercise_out(le: LoggedExercise) -> LoggedExerciseOut:
    return LoggedExerciseOut(
        id=le.id,
        exercise_id=le.exercise_id,
        order=le.order,
        exercise=_exercise_out(le.exercise),
        sets=[_set_out(s) for s in le.sets],
    )


def _workout_out(w: WorkoutLog) -> WorkoutOut:
    return WorkoutOut(
        id=w.id,
        title=w.title,
        notes=w.notes,
        started_at=w.started_at,
        ended_at=w.ended_at,
        exercises=[_logged_exercise_out(le) for le in w.exercises],
    )


def _routine_out(r: Routine) -> RoutineOut:
    return RoutineOut(
        id=r.id,
        name=r.name,
        created_at=r.created_at,
        exercises=[
            RoutineExerciseOut(
                exercise_id=re.exercise_id,
                order=re.order,
                exercise=_exercise_out(re.exercise),
            )
            for re in r.exercises
        ],
    )


# ── Loaders (eagerly fetch relationships — never lazy-load in async) ──────────


async def _load_workout(db: AsyncSession, workout_id: str, user_id: str) -> WorkoutLog | None:
    """Load one owned workout with its exercises (catalog detail) and sets."""
    stmt = (
        select(WorkoutLog)
        .where(WorkoutLog.id == workout_id, WorkoutLog.user_id == user_id)
        .options(
            selectinload(WorkoutLog.exercises).selectinload(LoggedExercise.sets),
            selectinload(WorkoutLog.exercises).selectinload(LoggedExercise.exercise),
        )
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _load_routine(db: AsyncSession, routine_id: str, user_id: str) -> Routine | None:
    """Load one owned routine with its ordered exercises (catalog detail)."""
    stmt = (
        select(Routine)
        .where(Routine.id == routine_id, Routine.user_id == user_id)
        .options(selectinload(Routine.exercises).selectinload(RoutineExercise.exercise))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _get_exercise(db: AsyncSession, slug: str) -> Exercise | None:
    return (await db.execute(select(Exercise).where(Exercise.slug == slug))).scalar_one_or_none()


def _day_start(d: date) -> datetime:
    """Aware UTC midnight for a date — used for date-range workout filtering."""
    return datetime.combine(d, time.min, tzinfo=UTC)


# ── Catalog ───────────────────────────────────────────────────────────────────


@router.get("/exercises", response_model=list[ExerciseOut])
async def browse_exercises(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    search: str | None = Query(default=None),
    muscle: str | None = Query(default=None),
    equipment: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ExerciseOut]:
    """Browse/search the shared exercise catalog (auth required)."""
    rows = await search_catalog(
        db, search=search, muscle=muscle, equipment=equipment, limit=limit, offset=offset
    )
    return [_exercise_out(r) for r in rows]


@router.get("/exercises/{slug}", response_model=ExerciseOut)
async def get_exercise(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExerciseOut:
    ex = await _get_exercise(db, slug)
    if ex is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="exercise not found")
    return _exercise_out(ex)


@router.get("/exercises/{slug}/history", response_model=ExerciseHistoryOut)
async def get_exercise_history_route(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExerciseHistoryOut:
    """This user's past sets of an exercise, with total volume and best 1RM."""
    ex = await _get_exercise(db, slug)
    if ex is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="exercise not found")
    return await get_exercise_history(db, user_id=user.id, exercise=ex)


# ── Workouts ──────────────────────────────────────────────────────────────────


@router.get("/workouts", response_model=list[WorkoutSummary])
async def list_workouts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = Query(default=None, alias="to"),
) -> list[WorkoutSummary]:
    """List the caller's workouts (newest first), optionally within a date range."""
    stmt = select(WorkoutLog).where(WorkoutLog.user_id == user.id)
    if from_ is not None:
        stmt = stmt.where(WorkoutLog.started_at >= _day_start(from_))
    if to is not None:
        stmt = stmt.where(WorkoutLog.started_at < _day_start(to + timedelta(days=1)))
    stmt = stmt.order_by(WorkoutLog.started_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [
        WorkoutSummary(
            id=w.id, title=w.title, notes=w.notes, started_at=w.started_at, ended_at=w.ended_at
        )
        for w in rows
    ]


@router.get("/workouts/{workout_id}", response_model=WorkoutOut)
async def get_workout(
    workout_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkoutOut:
    """Read one owned workout with its ordered exercises and sets."""
    w = await _load_workout(db, workout_id, user.id)
    if w is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workout not found")
    return _workout_out(w)


@router.post("/workouts", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
async def create_workout(
    body: WorkoutCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkoutOut:
    w = WorkoutLog(user_id=user.id, title=body.title, notes=body.notes)
    if body.started_at is not None:
        w.started_at = body.started_at
    db.add(w)
    await db.flush()
    logger.info("workout_created", user_id=user.id, workout_id=w.id)
    # A fresh workout has no exercises yet — build directly to avoid a lazy load.
    return WorkoutOut(
        id=w.id, title=w.title, notes=w.notes, started_at=w.started_at, ended_at=w.ended_at, exercises=[]
    )


@router.patch("/workouts/{workout_id}", response_model=WorkoutOut)
async def update_workout(
    workout_id: str,
    body: WorkoutUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkoutOut:
    stmt = select(WorkoutLog).where(
        WorkoutLog.id == workout_id, WorkoutLog.user_id == user.id
    )
    w = (await db.execute(stmt)).scalar_one_or_none()
    if w is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workout not found")
    if body.title is not None:
        w.title = body.title
    if body.notes is not None:
        w.notes = body.notes
    if body.ended_at is not None:
        w.ended_at = body.ended_at
    await db.flush()
    loaded = await _load_workout(db, workout_id, user.id)
    assert loaded is not None  # just confirmed ownership above
    logger.info("workout_updated", user_id=user.id, workout_id=workout_id)
    return _workout_out(loaded)


@router.delete("/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workout(
    workout_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Load the full graph so the ORM delete-orphan cascade removes the children
    # (the in-memory SQLite test engine does not enforce FK ON DELETE CASCADE).
    w = await _load_workout(db, workout_id, user.id)
    if w is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workout not found")
    await db.delete(w)
    await db.flush()
    logger.info("workout_deleted", user_id=user.id, workout_id=workout_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workouts/{workout_id}/exercises",
    response_model=LoggedExerciseOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_exercise_to_workout(
    workout_id: str,
    body: AddExerciseRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LoggedExerciseOut:
    owned = (
        await db.execute(
            select(WorkoutLog).where(
                WorkoutLog.id == workout_id, WorkoutLog.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workout not found")

    ex = (
        await db.execute(select(Exercise).where(Exercise.id == body.exercise_id))
    ).scalar_one_or_none()
    if ex is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="exercise not found")

    if body.order is not None:
        order = body.order
    else:
        order = (
            await db.execute(
                select(func.count())
                .select_from(LoggedExercise)
                .where(LoggedExercise.workout_log_id == workout_id)
            )
        ).scalar_one()
    le = LoggedExercise(workout_log_id=workout_id, exercise_id=ex.id, order=order)
    db.add(le)
    await db.flush()
    logger.info("workout_exercise_added", user_id=user.id, workout_id=workout_id, exercise_id=ex.id)
    return LoggedExerciseOut(
        id=le.id, exercise_id=le.exercise_id, order=le.order, exercise=_exercise_out(ex), sets=[]
    )


# ── Sets ──────────────────────────────────────────────────────────────────────


async def _load_owned_set(db: AsyncSession, set_id: str, user_id: str) -> LoggedSet | None:
    """Load a set only if it belongs to one of the user's workouts."""
    stmt = (
        select(LoggedSet)
        .join(LoggedExercise, LoggedSet.logged_exercise_id == LoggedExercise.id)
        .join(WorkoutLog, LoggedExercise.workout_log_id == WorkoutLog.id)
        .where(LoggedSet.id == set_id, WorkoutLog.user_id == user_id)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


@router.post(
    "/logged-exercises/{logged_exercise_id}/sets",
    response_model=SetOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_set(
    logged_exercise_id: str,
    body: SetCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SetOut:
    stmt = (
        select(LoggedExercise)
        .join(WorkoutLog, LoggedExercise.workout_log_id == WorkoutLog.id)
        .where(LoggedExercise.id == logged_exercise_id, WorkoutLog.user_id == user.id)
    )
    le = (await db.execute(stmt)).scalar_one_or_none()
    if le is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="logged exercise not found"
        )

    if body.set_number is not None:
        set_number = body.set_number
    else:
        existing = (
            await db.execute(
                select(func.count())
                .select_from(LoggedSet)
                .where(LoggedSet.logged_exercise_id == logged_exercise_id)
            )
        ).scalar_one()
        set_number = existing + 1

    s = LoggedSet(
        logged_exercise_id=logged_exercise_id,
        set_number=set_number,
        weight_kg=body.weight_kg,
        reps=body.reps,
        rpe=body.rpe,
        is_warmup=body.is_warmup,
        completed=body.completed,
    )
    db.add(s)
    await db.flush()
    logger.info("set_added", user_id=user.id, logged_exercise_id=logged_exercise_id, set_id=s.id)
    return _set_out(s)


@router.patch("/sets/{set_id}", response_model=SetOut)
async def update_set(
    set_id: str,
    body: SetUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SetOut:
    s = await _load_owned_set(db, set_id, user.id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="set not found")
    if body.weight_kg is not None:
        s.weight_kg = body.weight_kg
    if body.reps is not None:
        s.reps = body.reps
    if body.rpe is not None:
        s.rpe = body.rpe
    if body.is_warmup is not None:
        s.is_warmup = body.is_warmup
    if body.completed is not None:
        s.completed = body.completed
    if body.set_number is not None:
        s.set_number = body.set_number
    await db.flush()
    logger.info("set_updated", user_id=user.id, set_id=set_id)
    return _set_out(s)


@router.delete("/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_set(
    set_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    s = await _load_owned_set(db, set_id, user.id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="set not found")
    await db.delete(s)
    await db.flush()
    logger.info("set_deleted", user_id=user.id, set_id=set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Routines ──────────────────────────────────────────────────────────────────


@router.get("/routines", response_model=list[RoutineOut])
async def list_routines(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoutineOut]:
    stmt = (
        select(Routine)
        .where(Routine.user_id == user.id)
        .order_by(Routine.created_at.desc())
        .options(selectinload(Routine.exercises).selectinload(RoutineExercise.exercise))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_routine_out(r) for r in rows]


@router.post("/routines", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
async def create_routine(
    body: RoutineCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoutineOut:
    found = (
        await db.execute(select(Exercise.id).where(Exercise.id.in_(body.exercise_ids)))
    ).scalars().all()
    found_ids = set(found)
    missing = [eid for eid in body.exercise_ids if eid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"unknown exercise ids: {missing}",
        )
    r = Routine(user_id=user.id, name=body.name)
    db.add(r)
    await db.flush()
    for order, eid in enumerate(body.exercise_ids):
        db.add(RoutineExercise(routine_id=r.id, exercise_id=eid, order=order))
    await db.flush()
    loaded = await _load_routine(db, r.id, user.id)
    assert loaded is not None  # just created above
    logger.info("routine_created", user_id=user.id, routine_id=r.id, exercises=len(body.exercise_ids))
    return _routine_out(loaded)


@router.post(
    "/workouts/from-routine/{routine_id}",
    response_model=WorkoutOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_workout_from_routine(
    routine_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkoutOut:
    """Start a new workout pre-populated with a routine's exercises (no sets)."""
    routine = await _load_routine(db, routine_id, user.id)
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="routine not found")

    w = WorkoutLog(user_id=user.id, title=routine.name)
    db.add(w)
    await db.flush()
    for re in routine.exercises:
        db.add(LoggedExercise(workout_log_id=w.id, exercise_id=re.exercise_id, order=re.order))
    await db.flush()
    loaded = await _load_workout(db, w.id, user.id)
    assert loaded is not None  # just created above
    logger.info(
        "workout_from_routine", user_id=user.id, routine_id=routine_id, workout_id=w.id
    )
    return _workout_out(loaded)
