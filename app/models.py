import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    sessions: Mapped[list["WorkoutSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    prep_cycles: Mapped[list["PrepCycle"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    exercise: Mapped[str] = mapped_column(String, nullable=False)
    # "exercise" (rep-based form scoring) or "posing" (held-pose scoring, P16).
    # For posing sessions, ``exercise`` holds the pose id (e.g. "front_double_biceps").
    session_type: Mapped[str] = mapped_column(
        String, nullable=False, server_default="exercise", default="exercise"
    )
    rep_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_form_score: Mapped[float] = mapped_column(Float, default=0.0)
    # 1-tap post-set self-report (P16): 1 = too easy, 3 = just right, 5 = too hard
    effort_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Optional contest-prep cycle this session belongs to (P17). Null = ungrouped.
    prep_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("prep_cycles.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # keypoints/scores only — never raw frames
    keypoints_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")
    prep: Mapped["PrepCycle | None"] = relationship(back_populates="sessions")


class PrepCycle(Base):
    """A contest-prep cycle (P17): a named run-up to a show date that groups
    posing rehearsals so improvement is visible week over week."""

    __tablename__ = "prep_cycles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    show_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    user: Mapped["User"] = relationship(back_populates="prep_cycles")
    sessions: Mapped[list["WorkoutSession"]] = relationship(back_populates="prep")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


# ── P24: workout logger (additive; WorkoutSession above is untouched) ─────────
#
# A normalized gym-log schema separate from the CV ``WorkoutSession`` record:
#   Exercise (shared catalog) ← LoggedExercise → WorkoutLog (per user)
#                                     ↓
#                                  LoggedSet  ── optional CV link → workout_sessions
# Routine / RoutineExercise are reusable templates. Every per-user query filters
# by ``user_id`` (IDOR rule). CV-link columns on LoggedSet are nullable now and
# get wired up in P26.


class Exercise(Base):
    """Exercise-catalog row sourced from free-exercise-db (P24).

    Shared across all users (not per-user). ``slug`` is the stable business key
    used by the API and the bundled client search index.
    """

    __tablename__ = "exercises"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    equipment: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(JSON, default=list)
    secondary_muscles: Mapped[list[str]] = mapped_column(JSON, default=list)
    instructions: Mapped[list[str]] = mapped_column(JSON, default=list)
    image_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    youtube_id: Mapped[str | None] = mapped_column(String, nullable=True)
    is_cv_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Custom exercises (P29): owner_user_id is null for the shared seeded
    # catalog, set for a user's own addition. SET NULL on user delete — the
    # row just becomes an orphaned catalog entry (name/muscle group carry no
    # PII once unlinked), avoiding cross-table cascade-order dependence on
    # workout_logs -> logged_exercises being cleared first.
    owner_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class WorkoutLog(Base):
    """A logged gym workout (P24) — owns its exercises and their sets."""

    __tablename__ = "workout_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    exercises: Mapped[list["LoggedExercise"]] = relationship(
        back_populates="workout_log",
        cascade="all, delete-orphan",
        order_by="LoggedExercise.order",
    )


class LoggedExercise(Base):
    """One exercise slot inside a :class:`WorkoutLog`, ordered within the workout."""

    __tablename__ = "logged_exercises"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workout_log_id: Mapped[str] = mapped_column(
        String, ForeignKey("workout_logs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[str] = mapped_column(String, ForeignKey("exercises.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    workout_log: Mapped["WorkoutLog"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()
    sets: Mapped[list["LoggedSet"]] = relationship(
        back_populates="logged_exercise",
        cascade="all, delete-orphan",
        order_by="LoggedSet.set_number",
    )


class LoggedSet(Base):
    """One set: weight (canonical kg) × reps, with optional RPE and CV linkage."""

    __tablename__ = "logged_sets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    logged_exercise_id: Mapped[str] = mapped_column(
        String, ForeignKey("logged_exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    set_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_warmup: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # CV link columns — nullable now; the wiring that fills them is P26.
    form_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_session_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("workout_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    logged_exercise: Mapped["LoggedExercise"] = relationship(back_populates="sets")


class Routine(Base):
    """A reusable workout template (P24) — an ordered list of catalog exercises."""

    __tablename__ = "routines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    exercises: Mapped[list["RoutineExercise"]] = relationship(
        back_populates="routine",
        cascade="all, delete-orphan",
        order_by="RoutineExercise.order",
    )


class RoutineExercise(Base):
    """One ordered exercise slot inside a :class:`Routine` template."""

    __tablename__ = "routine_exercises"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    routine_id: Mapped[str] = mapped_column(
        String, ForeignKey("routines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exercise_id: Mapped[str] = mapped_column(String, ForeignKey("exercises.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    routine: Mapped["Routine"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()


# ── P27: calorie tracker (additive; everything above is untouched) ────────────
#
# FoodItem is both the server-side Open Food Facts cache (``source="off"``,
# shared across users, ``created_by`` NULL) and the store for per-user manual
# entries (``source="manual"``, visible only to their creator). FoodLogEntry is
# the daily diary; its macro columns are SNAPSHOTS computed at log time from
# ``amount_g`` × the food's per-100 g values, so a later cache refresh never
# rewrites diary history.


class FoodItem(Base):
    """A food product (P27): an OFF-cached product or a user's manual entry."""

    __tablename__ = "food_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # Nullable — manual entries have no barcode. Unique so each product caches once.
    barcode: Mapped[str | None] = mapped_column(String, unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    brand: Mapped[str | None] = mapped_column(String, nullable=True)
    serving_size_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_label: Mapped[str | None] = mapped_column(String, nullable=True)
    kcal_100g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    protein_100g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    carbs_100g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fat_100g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # "off" (shared cache row) or "manual" (per-user entry).
    source: Mapped[str] = mapped_column(String, nullable=False, default="off")
    # Set for manual foods only, so GDPR account deletion removes them.
    created_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class FoodLogEntry(Base):
    """One diary row (P27): a food eaten on a date, macros snapshotted at log time."""

    __tablename__ = "food_log_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    food_item_id: Mapped[str] = mapped_column(
        String, ForeignKey("food_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    logged_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    meal: Mapped[str] = mapped_column(String, nullable=False, default="snack")
    amount_g: Mapped[float] = mapped_column(Float, nullable=False)
    # Snapshot columns — computed server-side when the entry is created/updated.
    kcal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    protein_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    food_item: Mapped["FoodItem"] = relationship()


# ── P33: account recovery (additive; no existing table touched) ───────────────
#
# One-time, time-boxed password-reset tokens. Only the SHA-256 hash of the raw
# token is stored — a leaked DB row is useless because the raw token (mailed to
# the user) can't be derived from its hash. Single-use: ``used_at`` is stamped
# on a successful reset so the same link can't be replayed. Short TTL
# (``expires_at``) is the compensating control for the (descoped) lack of
# session invalidation on reset.


class PasswordResetToken(Base):
    """A single-use, expiring password-reset token (P33). Hash-at-rest only."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SHA-256 hex of the raw token; the raw token never lands in the DB or logs.
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Stamped on a successful reset — presence means the token is spent.
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")
