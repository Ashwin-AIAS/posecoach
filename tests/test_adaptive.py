"""Adaptive recommendation engine — every rule branch, plank, cold start, determinism."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pytest

from app.analysis.adaptive import (
    HOLD_DELTA_S,
    JOINT_LABELS,
    REP_DELTA,
    Recommendation,
    recommend,
)
from app.models import WorkoutSession


def _session(
    exercise: str = "squat",
    score: float = 75.0,
    effort: int | None = 3,
    ended: bool = True,
    snapshots: list[dict[str, Any]] | None = None,
    hours_ago: int = 0,
) -> WorkoutSession:
    """Synthetic ORM instance — never touches a DB (column defaults not needed)."""
    started = datetime.now(timezone.utc) - timedelta(hours=hours_ago + 1)
    return WorkoutSession(
        user_id="u1",
        exercise=exercise,
        rep_count=10,
        avg_form_score=score,
        keypoints_data={"snapshots": snapshots or []},
        started_at=started,
        ended_at=started + timedelta(minutes=10) if ended else None,
        effort_rating=effort,
    )


def _word_count(message: str) -> int:
    """Words = whitespace tokens containing at least one alphanumeric (skip em dashes)."""
    return sum(1 for tok in message.split() if any(c.isalnum() for c in tok))


# ── Rule branches ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("effort", "score", "expected_delta"),
    [
        (1, 85.0, REP_DELTA),    # easy + great form → progress
        (2, 80.0, REP_DELTA),    # boundary: effort 2, score exactly 80
        (5, 85.0, -REP_DELTA),   # too hard → back off
        (4, 70.0, -REP_DELTA),   # boundary: effort 4
        (1, 55.0, -REP_DELTA),   # poor form overrides easy effort
        (None, 75.0, 0),         # no rating → neutral
        (3, 75.0, 0),            # just right, decent form → hold
        (2, 79.9, 0),            # easy but form below 80 → hold, not progress
    ],
)
def test_rep_target_delta_per_rule(
    effort: int | None, score: float, expected_delta: int
) -> None:
    sessions = [_session(score=score, effort=effort), _session(score=70.0, hours_ago=24)]
    rec = recommend(sessions)
    assert rec is not None
    assert rec.exercise == "squat"
    assert rec.rep_target_delta == expected_delta
    assert _word_count(rec.message) <= 12


def test_progress_message_mentions_reps() -> None:
    rec = recommend([_session(score=90.0, effort=1), _session(hours_ago=24)])
    assert rec is not None
    assert "reps" in rec.message


@pytest.mark.parametrize(
    ("prev_score", "fragment"),
    [
        (60.0, "trending up"),
        (90.0, "dipped"),
        (75.0, "steady"),
    ],
)
def test_no_effort_message_cites_form_trend(prev_score: float, fragment: str) -> None:
    sessions = [
        _session(score=75.0, effort=None),
        _session(score=prev_score, hours_ago=24),
    ]
    rec = recommend(sessions)
    assert rec is not None
    assert rec.rep_target_delta == 0
    assert fragment in rec.message


# ── Plank special case (seconds, not reps) ────────────────────────────────────


def test_plank_progress_uses_seconds_delta() -> None:
    sessions = [
        _session(exercise="plank", score=90.0, effort=1),
        _session(exercise="plank", hours_ago=24),
    ]
    rec = recommend(sessions)
    assert rec is not None
    assert rec.rep_target_delta == HOLD_DELTA_S
    assert "seconds" in rec.message
    assert _word_count(rec.message) <= 12


def test_plank_backoff_uses_negative_seconds_delta() -> None:
    sessions = [
        _session(exercise="plank", score=50.0, effort=3),
        _session(exercise="plank", hours_ago=24),
    ]
    rec = recommend(sessions)
    assert rec is not None
    assert rec.rep_target_delta == -HOLD_DELTA_S
    assert "seconds" in rec.message


# ── Cold start ────────────────────────────────────────────────────────────────


def test_no_sessions_returns_none() -> None:
    assert recommend([]) is None


def test_single_completed_session_returns_none() -> None:
    assert recommend([_session()]) is None


def test_unfinished_sessions_do_not_count_as_completed() -> None:
    sessions = [_session(ended=False), _session(hours_ago=24)]
    assert recommend(sessions) is None


# ── focus_joint ───────────────────────────────────────────────────────────────


def test_focus_joint_none_without_snapshots() -> None:
    rec = recommend([_session(effort=3, score=75.0), _session(hours_ago=24)])
    assert rec is not None
    assert rec.focus_joint is None


def test_focus_joint_derived_from_snapshots() -> None:
    kp = np.random.default_rng(42).uniform(0.1, 0.9, (17, 2)).tolist()
    snaps = [{"ts": 1.0, "score": 70.0, "kp": kp}]
    rec = recommend(
        [_session(effort=3, score=75.0, snapshots=snaps), _session(hours_ago=24)]
    )
    assert rec is not None
    assert rec.focus_joint is not None
    assert rec.focus_joint.endswith("_angle")
    # Hold branch with a focus joint mentions its plain-English name
    label = JOINT_LABELS[rec.focus_joint]
    assert label in rec.message


def test_malformed_snapshots_are_skipped() -> None:
    snaps: list[dict[str, Any]] = [
        {"ts": 1.0, "score": 70.0, "kp": [[0.1, 0.2]]},  # wrong shape
        {"ts": 2.0, "score": 70.0, "kp": "garbage"},
        {"ts": 3.0},
    ]
    rec = recommend(
        [_session(effort=3, score=75.0, snapshots=snaps), _session(hours_ago=24)]
    )
    assert rec is not None
    assert rec.focus_joint is None


# ── Determinism ───────────────────────────────────────────────────────────────


def test_recommend_is_deterministic() -> None:
    kp = np.random.default_rng(7).uniform(0.1, 0.9, (17, 2)).tolist()
    sessions = [
        _session(effort=3, score=72.0, snapshots=[{"ts": 1.0, "score": 70.0, "kp": kp}]),
        _session(score=68.0, hours_ago=24),
    ]
    first = recommend(sessions)
    second = recommend(sessions)
    assert isinstance(first, Recommendation)
    assert first == second
