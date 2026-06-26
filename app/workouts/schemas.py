"""Pydantic request/response schemas for the workout-logger API (P24)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# Plausible bounds — RPE is the 1–10 rate-of-perceived-exertion scale.
RPE_MIN = 1.0
RPE_MAX = 10.0


class ExerciseOut(BaseModel):
    """A shared-catalog exercise as served to clients."""

    id: str
    slug: str
    name: str
    category: str | None
    equipment: str | None
    primary_muscles: list[str]
    secondary_muscles: list[str]
    instructions: list[str]
    image_urls: list[str]
    youtube_id: str | None
    is_cv_supported: bool


class SetOut(BaseModel):
    """One logged set, including the (P26-filled) optional CV-link fields."""

    id: str
    set_number: int
    weight_kg: float
    reps: int
    rpe: float | None
    is_warmup: bool
    completed: bool
    form_score: float | None
    source_session_id: str | None


class SetCreate(BaseModel):
    """Create a set. ``set_number`` auto-assigns to the next slot when omitted."""

    weight_kg: float = Field(ge=0)
    reps: int = Field(ge=0)
    rpe: float | None = Field(default=None, ge=RPE_MIN, le=RPE_MAX)
    is_warmup: bool = False
    completed: bool = True
    set_number: int | None = Field(default=None, ge=1)


class SetUpdate(BaseModel):
    """Partial set update — only provided fields are changed."""

    weight_kg: float | None = Field(default=None, ge=0)
    reps: int | None = Field(default=None, ge=0)
    rpe: float | None = Field(default=None, ge=RPE_MIN, le=RPE_MAX)
    is_warmup: bool | None = None
    completed: bool | None = None
    set_number: int | None = Field(default=None, ge=1)


class LoggedExerciseOut(BaseModel):
    """An exercise slot within a workout, with its catalog detail and sets."""

    id: str
    exercise_id: str
    order: int
    exercise: ExerciseOut
    sets: list[SetOut]


class AddExerciseRequest(BaseModel):
    """Add a catalog exercise to a workout. ``order`` appends when omitted."""

    exercise_id: str
    order: int | None = Field(default=None, ge=0)


class WorkoutCreate(BaseModel):
    """Start a workout log."""

    title: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    started_at: datetime | None = None


class WorkoutUpdate(BaseModel):
    """Partial workout update (e.g. set ``ended_at`` to finish a session)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    ended_at: datetime | None = None


class WorkoutSummary(BaseModel):
    """A workout without its nested exercises — used for list views."""

    id: str
    title: str
    notes: str | None
    started_at: datetime
    ended_at: datetime | None


class WorkoutOut(WorkoutSummary):
    """A workout with its ordered exercises and sets."""

    exercises: list[LoggedExerciseOut]


class SetHistoryEntry(BaseModel):
    """One past set of an exercise, with its estimated 1RM."""

    workout_id: str
    performed_at: datetime
    weight_kg: float
    reps: int
    est_one_rep_max: float


class ExerciseHistoryOut(BaseModel):
    """The caller's history for a single exercise: every set + aggregates."""

    slug: str
    name: str
    total_sets: int
    total_volume_kg: float
    best_one_rep_max: float
    entries: list[SetHistoryEntry]


class RoutineExerciseOut(BaseModel):
    """One ordered exercise slot in a routine template."""

    exercise_id: str
    order: int
    exercise: ExerciseOut


class RoutineCreate(BaseModel):
    """Create a reusable routine from an ordered list of catalog exercise ids."""

    name: str = Field(min_length=1, max_length=200)
    exercise_ids: list[str] = Field(min_length=1)


class RoutineOut(BaseModel):
    """A routine template with its ordered exercises."""

    id: str
    name: str
    created_at: datetime
    exercises: list[RoutineExerciseOut]
