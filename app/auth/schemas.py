"""Pydantic schemas for auth + history responses."""
from __future__ import annotations

from datetime import datetime
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
