"""Per-joint form scores must reflect known squat geometries.

Builds synthetic keypoints whose knee/hip angles are controlled exactly, then
asserts ``score_exercise`` produces per-joint scores matching the documented
in-range/penalty formula within ±5, plus the right shape and measured angles.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis.form_scorer import joint_range, score_exercise
from app.analysis.keypoint_utils import (
    LEFT_ANKLE,
    LEFT_HIP,
    LEFT_KNEE,
    LEFT_SHOULDER,
    RIGHT_ANKLE,
    RIGHT_HIP,
    RIGHT_KNEE,
    RIGHT_SHOULDER,
)

_SQUAT_JOINTS = {"left_knee_angle", "right_knee_angle", "left_hip_angle", "right_hip_angle"}
_LIMB = 0.15  # normalized segment length


def _squat_pose(knee_deg: float, hip_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Build a symmetric squat pose with exact knee and hip angles.

    Left leg: knee fixed at (0.4, 0.6), thigh straight up so the hip sits above
    the knee; the shank is rotated by ``knee_deg`` off the thigh. The shoulder is
    placed so the hip angle (shoulder–hip–knee) equals ``hip_deg``. The right leg
    mirrors x about 0.4 (angles are preserved under reflection).
    """
    kp = np.zeros((17, 2), dtype=float)
    conf = np.zeros(17, dtype=float)

    knee = np.array([0.4, 0.6])
    thigh = np.array([0.0, -1.0])  # knee -> hip (up)
    hip = knee + _LIMB * thigh

    th = np.radians(knee_deg)
    shank = np.array([np.sin(th), -np.cos(th)])  # knee -> ankle, angle knee_deg off thigh
    ankle = knee + _LIMB * shank

    ph = np.radians(hip_deg)
    # hip -> knee is (0, +1); choose hip -> shoulder = (sin ph, cos ph) so the
    # interior angle at the hip equals hip_deg.
    shoulder_dir = np.array([np.sin(ph), np.cos(ph)])
    shoulder = hip + _LIMB * shoulder_dir

    def mirror(p: np.ndarray) -> np.ndarray:
        return np.array([0.8 - p[0], p[1]])

    for idx, pt in (
        (LEFT_SHOULDER, shoulder),
        (LEFT_HIP, hip),
        (LEFT_KNEE, knee),
        (LEFT_ANKLE, ankle),
    ):
        kp[idx] = pt
        conf[idx] = 1.0
    for idx, pt in (
        (RIGHT_SHOULDER, shoulder),
        (RIGHT_HIP, hip),
        (RIGHT_KNEE, knee),
        (RIGHT_ANKLE, ankle),
    ):
        kp[idx] = mirror(pt)
        conf[idx] = 1.0

    return kp, conf


def _expected_score(joint: str, angle: float) -> float:
    """Reference value via the P13 graded mover curve (squat joints are movers).

    Full credit across the full healthy ROM [p5, p95]; linear taper to 0 over a
    margin of half the range outside it. Independently re-derived here (not
    importing the scorer internals) so it still validates the implementation.
    """
    bounds = joint_range("squat", joint)
    assert bounds is not None
    lo, hi = bounds
    span = max(hi - lo, 10.0)
    margin = max(0.5 * span, 12.0)
    if lo <= angle <= hi:
        return 100.0
    if angle < lo:
        return max(0.0, 100.0 * (angle - (lo - margin)) / margin)
    return max(0.0, 100.0 * ((hi + margin) - angle) / margin)


# (label, knee_deg, hip_deg): a good rep (both in range), a borderline rep
# (knee just below p5), and a bad rep (both far outside).
_CASES = [
    ("good", 157.0, 120.0),
    ("borderline", 60.0, 120.0),
    ("bad", 20.0, 35.0),
]


@pytest.mark.parametrize("label,knee_deg,hip_deg", _CASES)
def test_joint_scores_shape(label: str, knee_deg: float, hip_deg: float) -> None:
    kp, conf = _squat_pose(knee_deg, hip_deg)
    result = score_exercise("squat", kp, conf)
    assert set(result.joint_scores) == _SQUAT_JOINTS
    assert set(result.measured_angles) == _SQUAT_JOINTS


@pytest.mark.parametrize("label,knee_deg,hip_deg", _CASES)
def test_joint_scores_match_formula(label: str, knee_deg: float, hip_deg: float) -> None:
    kp, conf = _squat_pose(knee_deg, hip_deg)
    result = score_exercise("squat", kp, conf)
    for joint, score in result.joint_scores.items():
        measured = result.measured_angles[joint]
        expected = _expected_score(joint, measured)
        assert abs(score - expected) <= 5.0, f"{label}/{joint}: {score} vs {expected}"


@pytest.mark.parametrize("label,knee_deg,hip_deg", _CASES)
def test_measured_angles_are_accurate(label: str, knee_deg: float, hip_deg: float) -> None:
    kp, conf = _squat_pose(knee_deg, hip_deg)
    result = score_exercise("squat", kp, conf)
    for joint in ("left_knee_angle", "right_knee_angle"):
        assert abs(result.measured_angles[joint] - knee_deg) <= 1.0
    for joint in ("left_hip_angle", "right_hip_angle"):
        assert abs(result.measured_angles[joint] - hip_deg) <= 1.0


def test_good_pose_scores_higher_than_bad() -> None:
    good_kp, good_conf = _squat_pose(157.0, 120.0)
    bad_kp, bad_conf = _squat_pose(20.0, 35.0)
    good = score_exercise("squat", good_kp, good_conf)
    bad = score_exercise("squat", bad_kp, bad_conf)
    assert good.score > bad.score
    assert good.score >= 95.0
