"""worst_joint() must select the lowest-scoring joint (argmin)."""
from __future__ import annotations

import numpy as np

from app.analysis.form_scorer import score_exercise, worst_joint


def test_worst_joint_returns_argmin() -> None:
    scores = {"left_knee_angle": 90.0, "right_knee_angle": 40.0, "left_hip_angle": 75.0}
    assert worst_joint(scores) == "right_knee_angle"


def test_worst_joint_single_entry() -> None:
    assert worst_joint({"left_hip_angle": 52.3}) == "left_hip_angle"


def test_worst_joint_empty_returns_none() -> None:
    assert worst_joint({}) is None


def test_worst_joint_tie_returns_first_seen() -> None:
    # Both 60.0 — argmin is deterministic on insertion order.
    scores = {"a": 60.0, "b": 60.0, "c": 80.0}
    assert worst_joint(scores) == "a"


def test_worst_joint_all_perfect() -> None:
    scores = {"a": 100.0, "b": 100.0, "c": 100.0}
    assert worst_joint(scores) == "a"


def test_worst_joint_matches_score_exercise_output() -> None:
    """The argmin of a real scoring run is a valid joint key with the min score."""
    kp = np.random.default_rng(7).uniform(0.1, 0.9, (17, 2)).astype(float)
    kp_conf = np.ones(17, dtype=float)
    result = score_exercise("squat", kp, kp_conf)
    key = worst_joint(result.joint_scores)
    assert key is not None
    assert key in result.joint_scores
    assert result.joint_scores[key] == min(result.joint_scores.values())
