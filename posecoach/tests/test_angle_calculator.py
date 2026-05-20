"""Parametrized angle computation tests for known geometries."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.analysis.keypoint_utils import compute_angle, compute_angles

# fmt: off
_RIGHT_ANGLE_CASES: list[tuple[tuple[float,float], tuple[float,float], tuple[float,float], float]] = [
    ((1,0), (0,0), (0,1),  90.0),   # pure right angle
    ((1,0), (0,0), (1,0),   0.0),   # degenerate — same vector, 0°
    ((1,0), (0,0), (-1,0), 180.0),  # straight line
    ((0,1), (0,0), (1,0),  90.0),   # rotated right angle
]
# fmt: on


@pytest.mark.parametrize("a,b,c,expected", _RIGHT_ANGLE_CASES)
def test_compute_angle_known_geometry(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    expected: float,
) -> None:
    arr_a = np.array(a, dtype=float)
    arr_b = np.array(b, dtype=float)
    arr_c = np.array(c, dtype=float)
    result = compute_angle(arr_a, arr_b, arr_c)
    assert abs(result - expected) < 1e-4, f"got {result}, expected {expected}"


def test_compute_angle_45_degrees() -> None:
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 0.0])
    c = np.array([1.0, 1.0])
    assert abs(compute_angle(a, b, c) - 45.0) < 0.01


def test_compute_angles_returns_none_for_low_confidence() -> None:
    kp = np.zeros((17, 2), dtype=float)
    # All confidence = 0 → all angles should be None
    kp_conf = np.zeros(17, dtype=float)
    angles = compute_angles(kp, kp_conf)
    for v in angles.values():
        assert v is None


def test_compute_angles_high_confidence_returns_floats() -> None:
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.ones(17, dtype=float)
    angles = compute_angles(kp, kp_conf)
    for k, v in angles.items():
        assert v is not None, f"{k} unexpectedly None"
        assert 0.0 <= v <= 180.0, f"{k}={v} out of [0,180]"


def test_degenerate_zero_length_vector_returns_zero() -> None:
    # When b == a, vector ba is zero → should not crash
    a = np.array([0.5, 0.5])
    b = np.array([0.5, 0.5])  # same as a
    c = np.array([0.8, 0.2])
    assert compute_angle(a, b, c) == 0.0


@pytest.mark.parametrize("exercise", ["squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank"])
def test_compute_angles_covers_all_exercise_joints(exercise: str) -> None:
    """All joints needed for each exercise must be computable with good keypoints."""
    from app.analysis.form_scorer import _EXERCISE_JOINTS
    kp = np.random.rand(17, 2).astype(float)
    kp_conf = np.ones(17, dtype=float)
    angles = compute_angles(kp, kp_conf)
    joints = _EXERCISE_JOINTS[exercise]
    for joint in joints:
        assert joint in angles, f"joint '{joint}' missing from compute_angles output"
