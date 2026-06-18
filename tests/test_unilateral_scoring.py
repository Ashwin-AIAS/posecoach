"""Single-arm execution must score and cue only the working arm.

Covers FIX_UNILATERAL_ARM_SCORING.md: a paired-limb exercise (e.g. curl) done
with one arm idle at the side must not have that idle arm scored or cued
alongside the active one, while genuine two-arm execution is unaffected.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.analysis.form_scorer import score_exercise
from app.analysis.keypoint_utils import (
    LEFT_ELBOW,
    LEFT_HIP,
    LEFT_SHOULDER,
    LEFT_WRIST,
    RIGHT_ELBOW,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
)


def _rotate(vec: np.ndarray, degrees: float) -> np.ndarray:
    rad = math.radians(degrees)
    c, s = math.cos(rad), math.sin(rad)
    return np.array([vec[0] * c - vec[1] * s, vec[0] * s + vec[1] * c])


def _set_arm(
    kp: np.ndarray,
    *,
    shoulder_idx: int,
    elbow_idx: int,
    wrist_idx: int,
    elbow_pos: tuple[float, float],
    elbow_angle_deg: float,
    length: float = 0.15,
) -> None:
    """Place shoulder/elbow/wrist so the elbow angle is exactly elbow_angle_deg."""
    elbow = np.array(elbow_pos, dtype=float)
    shoulder_dir = np.array([0.0, 1.0])
    kp[elbow_idx] = elbow
    kp[shoulder_idx] = elbow + shoulder_dir * length
    kp[wrist_idx] = elbow + _rotate(shoulder_dir, elbow_angle_deg) * length


def _base_kp() -> tuple[np.ndarray, np.ndarray]:
    kp = np.random.default_rng(7).uniform(0.1, 0.9, (17, 2)).astype(float)
    kp_conf = np.ones(17, dtype=float)
    return kp, kp_conf


def _curl_kp(left_angle: float, right_angle: float) -> tuple[np.ndarray, np.ndarray]:
    kp, kp_conf = _base_kp()
    _set_arm(
        kp,
        shoulder_idx=LEFT_SHOULDER,
        elbow_idx=LEFT_ELBOW,
        wrist_idx=LEFT_WRIST,
        elbow_pos=(0.3, 0.5),
        elbow_angle_deg=left_angle,
    )
    _set_arm(
        kp,
        shoulder_idx=RIGHT_SHOULDER,
        elbow_idx=RIGHT_ELBOW,
        wrist_idx=RIGHT_WRIST,
        elbow_pos=(0.7, 0.5),
        elbow_angle_deg=right_angle,
    )
    return kp, kp_conf


def test_one_arm_curl_scores_only_the_active_arm() -> None:
    # Right arm mid-flex (working), left arm held near full extension (idle).
    kp, kp_conf = _curl_kp(left_angle=175.0, right_angle=60.0)
    result = score_exercise("curl", kp, kp_conf)

    assert "right_elbow_angle" in result.joint_scores
    assert "left_elbow_angle" not in result.joint_scores
    assert "left_elbow_angle" not in result.measured_angles
    assert result.score == result.joint_scores["right_elbow_angle"]
    assert result.score > 50.0, f"active-arm score unexpectedly low: {result.score}"
    assert not any("left" in c.lower() for c in result.cues)


def test_bilateral_curl_scores_both_arms_unchanged() -> None:
    # Both arms flexing together through the same working band.
    kp, kp_conf = _curl_kp(left_angle=70.0, right_angle=65.0)
    result = score_exercise("curl", kp, kp_conf)

    assert "left_elbow_angle" in result.joint_scores
    assert "right_elbow_angle" in result.joint_scores
    expected = (result.joint_scores["left_elbow_angle"] + result.joint_scores["right_elbow_angle"]) / 2.0
    assert result.score == pytest.approx(round(expected, 1), abs=0.05)


def test_single_visible_side_scores_that_side_only() -> None:
    kp, kp_conf = _curl_kp(left_angle=175.0, right_angle=60.0)
    # Gate out the left arm's keypoints via low confidence (simulates the
    # far arm being occluded/out of frame in a side-on stance).
    kp_conf[LEFT_SHOULDER] = 0.0
    kp_conf[LEFT_ELBOW] = 0.0
    kp_conf[LEFT_WRIST] = 0.0

    result = score_exercise("curl", kp, kp_conf)

    assert "right_elbow_angle" in result.joint_scores
    assert "left_elbow_angle" not in result.joint_scores
    assert result.score == result.joint_scores["right_elbow_angle"]


def test_one_arm_lateral_raise_scores_only_active_side() -> None:
    kp, kp_conf = _base_kp()
    # Active right arm raised to shoulder height; idle left arm hangs at the
    # side (shoulder angle near full extension, far outside the raise band).
    _set_arm(
        kp,
        shoulder_idx=LEFT_HIP,
        elbow_idx=LEFT_SHOULDER,
        wrist_idx=LEFT_ELBOW,
        elbow_pos=(0.3, 0.5),
        elbow_angle_deg=170.0,
    )
    _set_arm(
        kp,
        shoulder_idx=RIGHT_HIP,
        elbow_idx=RIGHT_SHOULDER,
        wrist_idx=RIGHT_ELBOW,
        elbow_pos=(0.7, 0.5),
        elbow_angle_deg=55.0,
    )

    result = score_exercise("lateral_raise", kp, kp_conf)

    assert "right_shoulder_angle" in result.joint_scores
    assert "left_shoulder_angle" not in result.joint_scores


def test_squat_is_never_unilateral_capable() -> None:
    # squat has two mover pairs (knee + hip sweep together) so there is no
    # single side to isolate — regression guard for _mover_pair's ambiguity
    # rule (must return None when more than one pair qualifies).
    from app.analysis.form_scorer import _UNILATERAL_CAPABLE

    assert "squat" not in _UNILATERAL_CAPABLE
