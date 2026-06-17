"""Posing progress analytics — deterministic per-pose trends across a prep (P18).

A contest prep is a series of posing rehearsals (``WorkoutSession`` rows with
``session_type == "posing"``, grouped by ``prep_id``). This module turns those
rehearsals into a week-over-week trend per pose so the user can see symmetry and
hold steadiness improving as the show approaches.

Like :mod:`app.analysis.adaptive`, every value is *re-derived* from the stored
keypoint snapshots (``{"snapshots": [{"ts", "score", "kp"}, ...]}``) by running
them back through the deterministic :func:`score_pose` — no separate per-session
metrics are persisted, and the same stored frames always yield the same trend.
No LLM, no randomness: every branch is unit-testable.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from app.analysis.posing_scorer import (
    HOLD_STABILITY_TOLERANCE,
    STATUS_OK,
    pose_label,
    score_pose,
)
from app.models import WorkoutSession

NUM_KEYPOINTS = 17

# A steadiness estimate needs at least this many snapshots — a single frame has
# no temporal spread, so its steadiness is simply unknown (None) rather than a
# misleading "perfectly steady".
MIN_SNAPSHOTS_FOR_STEADINESS = 2


@dataclass(frozen=True)
class PosePoint:
    """One rehearsal's derived metrics for a single pose."""

    session_id: str
    started_at: datetime
    avg_score: float | None       # mean re-scored pose score, None if unscoreable
    symmetry: float | None        # mean L/R symmetry, None in profile / not scored
    steadiness: float | None      # 0–100 keypoint steadiness across the hold, None if <2 frames


@dataclass(frozen=True)
class PoseProgress:
    """The trend for one pose across a prep, plus the latest 'fix this next' cue."""

    pose: str
    label: str
    points: list[PosePoint] = field(default_factory=list)  # chronological (oldest first)
    focus_cue: str | None = None  # top coaching cue from the most recent rehearsal


def _snapshots(session: WorkoutSession) -> list[dict[str, Any]]:
    """Valid snapshot dicts stored on a session (defensive against bad data)."""
    data: dict[str, Any] = session.keypoints_data or {}
    raw = data.get("snapshots")
    if not isinstance(raw, list):
        return []
    return [s for s in raw if isinstance(s, dict)]


def _kp(snap: dict[str, Any]) -> np.ndarray[Any, np.dtype[np.float64]] | None:
    """Parse a snapshot's keypoints into a (17, 2) float array, or None if malformed."""
    try:
        kp = np.asarray(snap.get("kp"), dtype=float)
    except (TypeError, ValueError):
        return None
    return kp if kp.shape == (NUM_KEYPOINTS, 2) else None


def _steadiness(frames: list[np.ndarray[Any, np.dtype[np.float64]]]) -> float | None:
    """Map mean per-keypoint positional jitter across snapshots to 0–100.

    Mirrors :meth:`HoldTracker._stability` but over the session's stored
    snapshots (spaced over the whole hold) rather than a live frame window —
    so it measures how much the pose drifted across the rehearsal.
    """
    if len(frames) < MIN_SNAPSHOTS_FOR_STEADINESS:
        return None
    stack = np.stack(frames)  # (frames, 17, 2)
    jitter = float(np.mean(np.std(stack, axis=0)))
    steadiness = 100.0 * (1.0 - jitter / HOLD_STABILITY_TOLERANCE)
    return max(0.0, min(100.0, steadiness))


def _session_point(session: WorkoutSession) -> PosePoint:
    """Re-score a session's snapshots into one trend point (deterministic).

    Snapshots were captured post-smoothing and post-confidence-gate, so a
    full-confidence vector re-scores exactly what was trusted live.
    """
    pose = session.exercise
    conf = np.ones(NUM_KEYPOINTS, dtype=float)

    scores: list[float] = []
    symmetries: list[float] = []
    frames: list[np.ndarray[Any, np.dtype[np.float64]]] = []

    for snap in _snapshots(session):
        kp = _kp(snap)
        if kp is None:
            continue
        result = score_pose(pose, kp, conf)
        if result.status != STATUS_OK:
            continue
        scores.append(result.score)
        if result.symmetry_applicable:
            symmetries.append(result.symmetry_score)
        frames.append(kp)

    avg_score = round(float(np.mean(scores)), 1) if scores else None
    symmetry = round(float(np.mean(symmetries)), 1) if symmetries else None
    steadiness = _steadiness(frames)
    return PosePoint(
        session_id=session.id,
        started_at=session.started_at,
        avg_score=avg_score,
        symmetry=symmetry,
        steadiness=None if steadiness is None else round(steadiness, 1),
    )


def _focus_cue(session: WorkoutSession) -> str | None:
    """Top 'fix this next' cue from a session's most recent scoreable snapshot."""
    pose = session.exercise
    conf = np.ones(NUM_KEYPOINTS, dtype=float)
    for snap in reversed(_snapshots(session)):
        kp = _kp(snap)
        if kp is None:
            continue
        result = score_pose(pose, kp, conf)
        if result.status == STATUS_OK:
            return result.cues[0] if result.cues else None
    return None


def summarize_posing_progress(sessions: Sequence[WorkoutSession]) -> list[PoseProgress]:
    """Group posing rehearsals by pose and build a per-pose trend.

    Args:
        sessions: Posing sessions for one prep (any order). Non-posing sessions
            and sessions with no scoreable snapshots are ignored.

    Returns:
        One :class:`PoseProgress` per distinct pose that has at least one
        scoreable rehearsal, sorted by pose id for stable UI ordering. Each
        pose's points are ordered oldest-first so the chart reads left→right
        toward the show date.
    """
    by_pose: dict[str, list[WorkoutSession]] = {}
    for s in sessions:
        if s.session_type != "posing":
            continue
        by_pose.setdefault(s.exercise, []).append(s)

    progress: list[PoseProgress] = []
    for pose in sorted(by_pose):
        ordered = sorted(by_pose[pose], key=lambda s: s.started_at)
        points = [pt for s in ordered if (pt := _session_point(s)).avg_score is not None]
        if not points:
            continue
        progress.append(
            PoseProgress(
                pose=pose,
                label=pose_label(pose) or pose.replace("_", " ").title(),
                points=points,
                focus_cue=_focus_cue(ordered[-1]),
            )
        )
    return progress
