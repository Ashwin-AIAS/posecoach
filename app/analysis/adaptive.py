"""Adaptive coach — deterministic next-session recommendation (P16).

Closes the loop between sessions: the user's 1-tap effort rating plus the
measured form scores already stored on ``WorkoutSession`` drive a rule-based
recommendation for the next set. No LLM, no randomness — the same inputs
always produce the same output, so every branch is unit-testable.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.analysis.form_scorer import STATUS_OK, score_exercise, worst_joint
from app.models import WorkoutSession

# Rule thresholds (see ADAPTIVE_COACH_P16.md for the decision table)
MIN_COMPLETED_SESSIONS = 2
PROGRESS_SCORE_THRESHOLD = 80.0
BACKOFF_SCORE_THRESHOLD = 60.0
EASY_EFFORT_MAX = 2
HARD_EFFORT_MIN = 4
REP_DELTA = 2
HOLD_DELTA_S = 10  # plank is timed, not rep-counted — delta applies to seconds
TREND_EPSILON = 2.0  # avg-score change below this reads as "steady"
NUM_KEYPOINTS = 17

# Plain-English names for joint_scores keys (mirrors frontend lib/joints.ts)
JOINT_LABELS: dict[str, str] = {
    "left_knee_angle": "left knee",
    "right_knee_angle": "right knee",
    "left_hip_angle": "left hip",
    "right_hip_angle": "right hip",
    "left_elbow_angle": "left elbow",
    "right_elbow_angle": "right elbow",
    "left_shoulder_angle": "left shoulder",
    "right_shoulder_angle": "right shoulder",
    "hip_trunk_angle": "core",
}


@dataclass(frozen=True)
class Recommendation:
    exercise: str
    rep_target_delta: int      # -2, 0, or +2 vs last session's rep_count (seconds for plank)
    focus_joint: str | None    # worst-scoring joint from last session, if any
    message: str               # <= 12 words, plain English, no jargon


def _focus_joint(session: WorkoutSession) -> str | None:
    """Worst-scoring joint across a session's stored keypoint snapshots.

    Sessions persist ``{"snapshots": [{"ts", "score", "kp"}, ...]}`` — no
    per-joint scores — so each snapshot is re-scored through the existing
    ``score_exercise`` and the per-joint means feed the existing
    ``worst_joint`` helper (reused, not reimplemented).

    Args:
        session: The session whose snapshots to analyse.

    Returns:
        The lowest-scoring joint key (e.g. ``"left_knee_angle"``), or None
        when no snapshot yields a scoreable pose.
    """
    data: dict[str, Any] = session.keypoints_data or {}
    snapshots = data.get("snapshots")
    if not isinstance(snapshots, list):
        return None

    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    # Snapshots were captured post-smoothing and post-confidence-gate, so a
    # full-confidence vector simply re-scores what was already trusted live.
    conf = np.ones(NUM_KEYPOINTS, dtype=float)
    for snap in snapshots:
        if not isinstance(snap, dict):
            continue
        try:
            kp = np.asarray(snap.get("kp"), dtype=float)
        except (TypeError, ValueError):
            continue
        if kp.shape != (NUM_KEYPOINTS, 2):
            continue
        result = score_exercise(session.exercise, kp, conf)
        if result.status != STATUS_OK:
            continue
        for joint, js in result.joint_scores.items():
            totals[joint] = totals.get(joint, 0.0) + js
            counts[joint] = counts.get(joint, 0) + 1

    if not totals:
        return None
    means = {joint: totals[joint] / counts[joint] for joint in totals}
    return worst_joint(means)


def recommend(sessions: Sequence[WorkoutSession]) -> Recommendation | None:
    """Recommend the next session's load and focus for one exercise.

    Args:
        sessions: Most-recent-first sessions of ONE exercise for one user.

    Returns:
        A deterministic ``Recommendation``, or None on cold start (fewer than
        ``MIN_COMPLETED_SESSIONS`` completed sessions — the UI shows nothing).
    """
    completed = [s for s in sessions if s.ended_at is not None]
    if len(completed) < MIN_COMPLETED_SESSIONS:
        return None

    last = completed[0]
    is_hold = last.exercise == "plank"
    delta_step = HOLD_DELTA_S if is_hold else REP_DELTA
    unit = "ten seconds" if is_hold else "two reps"
    effort = last.effort_rating
    score = last.avg_form_score
    focus = _focus_joint(last)

    if effort is not None and effort <= EASY_EFFORT_MAX and score >= PROGRESS_SCORE_THRESHOLD:
        delta = delta_step
        message = f"Strong form, easy effort — add {unit} next time."
    elif (effort is not None and effort >= HARD_EFFORT_MIN) or score < BACKOFF_SCORE_THRESHOLD:
        delta = -delta_step
        message = f"Ease off {unit} and rebuild solid form."
    elif effort is None:
        delta = 0
        diff = score - completed[1].avg_form_score
        if diff > TREND_EPSILON:
            message = "Form trending up — keep the same target."
        elif diff < -TREND_EPSILON:
            message = "Form dipped a little — keep the same target."
        else:
            message = "Form holding steady — keep the same target."
    else:
        delta = 0
        if focus is not None:
            label = JOINT_LABELS.get(focus, focus.replace("_angle", "").replace("_", " "))
            message = f"Hold the target and polish your {label}."
        else:
            message = "Hold the target — smooth, controlled reps."

    return Recommendation(
        exercise=last.exercise,
        rep_target_delta=delta,
        focus_joint=focus,
        message=message,
    )
