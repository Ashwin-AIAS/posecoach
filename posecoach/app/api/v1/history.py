"""Workout session history routes.

Every query is filtered by ``user_id == current_user.id`` — direct lookup by
session ID without that filter would be an IDOR vulnerability.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.schemas import SessionDetail, SessionSummary
from app.db import get_db
from app.models import User, WorkoutSession

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/history", tags=["history"])


@router.get("/sessions", response_model=list[SessionSummary])
async def list_sessions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[SessionSummary]:
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user.id)
        .order_by(WorkoutSession.started_at.desc())
        .limit(min(limit, 200))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        SessionSummary(
            id=r.id,
            exercise=r.exercise,
            rep_count=r.rep_count,
            avg_form_score=r.avg_form_score,
            started_at=r.started_at,
            ended_at=r.ended_at,
        )
        for r in rows
    ]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    stmt = select(WorkoutSession).where(
        WorkoutSession.id == session_id, WorkoutSession.user_id == user.id
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    return SessionDetail(
        id=row.id,
        exercise=row.exercise,
        rep_count=row.rep_count,
        avg_form_score=row.avg_form_score,
        started_at=row.started_at,
        ended_at=row.ended_at,
        keypoints_data=row.keypoints_data or {},
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    stmt = select(WorkoutSession).where(
        WorkoutSession.id == session_id, WorkoutSession.user_id == user.id
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    await db.delete(row)
    await db.flush()
    logger.info("session_deleted", user_id=user.id, session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
