"""Workout session history routes.

Every query is filtered by ``user_id == current_user.id`` — direct lookup by
session ID without that filter would be an IDOR vulnerability.
"""
from __future__ import annotations

from datetime import date

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.adaptive import recommend
from app.analysis.form_scorer import SUPPORTED_EXERCISES
from app.analysis.posing_progress import summarize_posing_progress
from app.auth.deps import get_current_user
from app.auth.schemas import (
    AssignPrepRequest,
    FeedbackRequest,
    PosePointResponse,
    PoseProgressResponse,
    PrepCycleCreate,
    PrepCycleResponse,
    PrepProgressResponse,
    RecommendationResponse,
    SessionDetail,
    SessionSummary,
)
from app.db import get_db
from app.models import PrepCycle, User, WorkoutSession

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/history", tags=["history"])

# How many recent sessions of an exercise feed the recommendation engine
RECOMMENDATION_SESSION_LIMIT = 5

# Days per week — for the prep-cycle weeks-out countdown.
_DAYS_PER_WEEK = 7


def _weeks_out(show_date: date | None) -> int | None:
    """Whole weeks from today until ``show_date`` (negative once past), or None."""
    if show_date is None:
        return None
    return (show_date - date.today()).days // _DAYS_PER_WEEK


def _weeks_before(show_date: date | None, when: date) -> int | None:
    """Whole weeks from ``when`` until ``show_date`` (negative once past), or None.

    Used per-rehearsal so the timeline reads in weeks-out *at the time of that
    rehearsal* rather than relative to today.
    """
    if show_date is None:
        return None
    return (show_date - when).days // _DAYS_PER_WEEK


def _prep_response(row: PrepCycle) -> PrepCycleResponse:
    """Build the API response for a prep cycle, deriving its weeks-out countdown."""
    return PrepCycleResponse(
        id=row.id,
        name=row.name,
        show_date=row.show_date,
        created_at=row.created_at,
        weeks_out=_weeks_out(row.show_date),
    )


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
            session_type=r.session_type,
            rep_count=r.rep_count,
            avg_form_score=r.avg_form_score,
            started_at=r.started_at,
            ended_at=r.ended_at,
            effort_rating=r.effort_rating,
            prep_id=r.prep_id,
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
        session_type=row.session_type,
        rep_count=row.rep_count,
        avg_form_score=row.avg_form_score,
        started_at=row.started_at,
        ended_at=row.ended_at,
        effort_rating=row.effort_rating,
        prep_id=row.prep_id,
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


@router.patch("/sessions/{session_id}/feedback", response_model=SessionSummary)
async def submit_feedback(
    session_id: str,
    body: FeedbackRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionSummary:
    """Save the 1-tap effort rating for a session (idempotent overwrite)."""
    stmt = select(WorkoutSession).where(
        WorkoutSession.id == session_id, WorkoutSession.user_id == user.id
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
    row.effort_rating = body.effort
    await db.flush()
    logger.info("feedback_saved", user_id=user.id, session_id=session_id, effort=body.effort)
    return SessionSummary(
        id=row.id,
        exercise=row.exercise,
        session_type=row.session_type,
        rep_count=row.rep_count,
        avg_form_score=row.avg_form_score,
        started_at=row.started_at,
        ended_at=row.ended_at,
        effort_rating=row.effort_rating,
        prep_id=row.prep_id,
    )


@router.get("/recommendation", response_model=RecommendationResponse)
async def get_recommendation(
    exercise: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecommendationResponse | Response:
    """Next-session recommendation for an exercise; 204 on cold start."""
    name = exercise.lower().strip()
    if name not in SUPPORTED_EXERCISES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unsupported exercise '{exercise}'",
        )
    stmt = (
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.exercise == name)
        .order_by(WorkoutSession.started_at.desc())
        .limit(RECOMMENDATION_SESSION_LIMIT)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rec = recommend(rows)
    if rec is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    logger.info(
        "recommendation_served", user_id=user.id, exercise=name, delta=rec.rep_target_delta
    )
    return RecommendationResponse(
        exercise=rec.exercise,
        rep_target_delta=rec.rep_target_delta,
        focus_joint=rec.focus_joint,
        message=rec.message,
    )


# ── P17: contest-prep cycles ──────────────────────────────────────────────────


@router.post("/preps", response_model=PrepCycleResponse, status_code=status.HTTP_201_CREATED)
async def create_prep(
    body: PrepCycleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrepCycleResponse:
    """Create a named contest-prep cycle for grouping posing rehearsals."""
    row = PrepCycle(user_id=user.id, name=body.name, show_date=body.show_date)
    db.add(row)
    await db.flush()
    logger.info("prep_created", user_id=user.id, prep_id=row.id)
    return _prep_response(row)


@router.get("/preps", response_model=list[PrepCycleResponse])
async def list_preps(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PrepCycleResponse]:
    """List the caller's prep cycles (newest first) with weeks-out countdowns."""
    stmt = (
        select(PrepCycle)
        .where(PrepCycle.user_id == user.id)
        .order_by(PrepCycle.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_prep_response(r) for r in rows]


@router.patch("/sessions/{session_id}/prep", response_model=SessionDetail)
async def assign_session_prep(
    session_id: str,
    body: AssignPrepRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionDetail:
    """Tag (or, with prep_id=null, untag) a session to one of the caller's preps."""
    stmt = select(WorkoutSession).where(
        WorkoutSession.id == session_id, WorkoutSession.user_id == user.id
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

    if body.prep_id is not None:
        prep = (
            await db.execute(
                select(PrepCycle).where(
                    PrepCycle.id == body.prep_id, PrepCycle.user_id == user.id
                )
            )
        ).scalar_one_or_none()
        if prep is None:
            # 404 (not 403) to avoid leaking whether the prep exists for another user.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="prep not found")

    row.prep_id = body.prep_id
    await db.flush()
    logger.info("session_prep_assigned", user_id=user.id, session_id=session_id, prep_id=body.prep_id)
    return SessionDetail(
        id=row.id,
        exercise=row.exercise,
        session_type=row.session_type,
        rep_count=row.rep_count,
        avg_form_score=row.avg_form_score,
        started_at=row.started_at,
        ended_at=row.ended_at,
        effort_rating=row.effort_rating,
        prep_id=row.prep_id,
        keypoints_data=row.keypoints_data or {},
    )


@router.get("/preps/{prep_id}/progress", response_model=PrepProgressResponse)
async def get_prep_progress(
    prep_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PrepProgressResponse:
    """Per-pose symmetry & hold-steadiness trends across a contest prep (P18).

    Every posing rehearsal tagged to the prep is re-scored through the
    deterministic posing scorer and grouped by pose, so the timeline reads
    week-over-week toward the show date.
    """
    prep = (
        await db.execute(
            select(PrepCycle).where(PrepCycle.id == prep_id, PrepCycle.user_id == user.id)
        )
    ).scalar_one_or_none()
    if prep is None:
        # 404 (not 403) so a foreign prep_id is indistinguishable from a missing one.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="prep not found")

    stmt = (
        select(WorkoutSession)
        .where(
            WorkoutSession.user_id == user.id,
            WorkoutSession.prep_id == prep_id,
            WorkoutSession.session_type == "posing",
        )
        .order_by(WorkoutSession.started_at.asc())
    )
    sessions = (await db.execute(stmt)).scalars().all()
    progress = summarize_posing_progress(sessions)

    poses = [
        PoseProgressResponse(
            pose=p.pose,
            label=p.label,
            focus_cue=p.focus_cue,
            points=[
                PosePointResponse(
                    session_id=pt.session_id,
                    started_at=pt.started_at,
                    weeks_out=_weeks_before(prep.show_date, pt.started_at.date()),
                    avg_score=pt.avg_score,
                    symmetry=pt.symmetry,
                    steadiness=pt.steadiness,
                )
                for pt in p.points
            ],
        )
        for p in progress
    ]
    logger.info("prep_progress_served", user_id=user.id, prep_id=prep_id, poses=len(poses))
    return PrepProgressResponse(
        prep_id=prep.id,
        name=prep.name,
        show_date=prep.show_date,
        weeks_out=_weeks_out(prep.show_date),
        poses=poses,
    )
