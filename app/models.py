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
