"""Low-confidence keypoints must be skipped, not used in scoring."""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis.form_scorer import SUPPORTED_EXERCISES, score_exercise
from app.analysis.keypoint_utils import CONF_THRESHOLD, compute_angles


def test_zero_confidence_all_angles_none() -> None:
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.zeros(17, dtype=float)
    angles = compute_angles(kp, kp_conf)
    for name, val in angles.items():
        assert val is None, f"angle '{name}' should be None for zero confidence"


def test_partial_confidence_skips_affected_joints() -> None:
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.ones(17, dtype=float)
    # Kill left knee confidence → left_knee_angle should be None
    from app.analysis.keypoint_utils import LEFT_KNEE
    kp_conf[LEFT_KNEE] = 0.0
    angles = compute_angles(kp, kp_conf)
    assert angles["left_knee_angle"] is None
    # right_knee_angle should still be computed
    assert angles["right_knee_angle"] is not None


def test_threshold_boundary_below_excluded() -> None:
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.ones(17, dtype=float) * (CONF_THRESHOLD - 0.01)
    angles = compute_angles(kp, kp_conf)
    for val in angles.values():
        assert val is None


def test_threshold_boundary_at_included() -> None:
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.ones(17, dtype=float) * CONF_THRESHOLD
    angles = compute_angles(kp, kp_conf)
    # At exactly threshold, joints should be included
    non_none = [v for v in angles.values() if v is not None]
    assert len(non_none) > 0


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_all_low_confidence_returns_position_cue(exercise: str) -> None:
    kp = np.zeros((17, 2), dtype=float)
    kp_conf = np.zeros(17, dtype=float)
    result = score_exercise(exercise, kp, kp_conf)
    assert result.score == 0.0
    assert len(result.cues) >= 1
    # Should tell user to get in frame
    assert any("frame" in c.lower() or "position" in c.lower() for c in result.cues)
