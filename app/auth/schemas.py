"""Pydantic schemas for auth + history responses."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: str
    email: str
    created_at: datetime


class SessionSummary(BaseModel):
    id: str
    exercise: str
    # "exercise" or "posing" (P16). For posing, ``exercise`` holds the pose id.
    session_type: str = "exercise"
    rep_count: int
    avg_form_score: float
    started_at: datetime
    ended_at: datetime | None
    effort_rating: int | None = None


class SessionDetail(SessionSummary):
    # Contest-prep cycle this session belongs to (P17), or null if ungrouped.
    prep_id: str | None = None
    keypoints_data: dict[str, Any]


class FeedbackRequest(BaseModel):
    """1-tap post-set effort rating (P16): 1 = too easy … 5 = too hard."""

    effort: int = Field(ge=1, le=5)


class RecommendationResponse(BaseModel):
    """Next-session recommendation from the adaptive coach (P16)."""

    exercise: str
    rep_target_delta: int
    focus_joint: str | None
    message: str


class PrepCycleCreate(BaseModel):
    """Create a contest-prep cycle (P17)."""

    name: str = Field(min_length=1, max_length=120)
    show_date: date | None = None


class PrepCycleResponse(BaseModel):
    """A contest-prep cycle with a derived weeks-out countdown (P17)."""

    id: str
    name: str
    show_date: date | None
    created_at: datetime
    # Whole weeks until the show date (negative once past), null if no date set.
    weeks_out: int | None = None


class AssignPrepRequest(BaseModel):
    """Tag (or untag) a session to a prep cycle (P17). Null detaches it."""

    prep_id: str | None = None
