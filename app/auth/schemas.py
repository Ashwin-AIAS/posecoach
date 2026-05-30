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
    rep_count: int
    avg_form_score: float
    started_at: datetime
    ended_at: datetime | None


class SessionDetail(SessionSummary):
    keypoints_data: dict[str, Any]
