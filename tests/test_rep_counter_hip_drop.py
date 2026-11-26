"""Camera-angle-independent squat counting (hip-drop signal) + aspect-correct angles.

Regression tests for the "squats filmed from the front never count" bug: when
the knees bend toward the lens, the 2D knee angle stays in the ~110-176 degree
band and never crosses the knee machine's ~103 degree down gate, so the count
froze at 0-1 while side-on RDLs counted fine. The hip-drop machine counts off
how far the hips fall relative to standing height, which every camera angle sees.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.analysis.keypoint_utils import (
    LEFT_ANKLE,
    LEFT_HIP,
    RIGHT_ANKLE,
    RIGHT_HIP,
    compute_angle,
    compute_angles,
    hip_height,
)
from app.analysis.rep_counter import RepCounter

_KNEES = ("left_knee_angle", "right_knee_angle")


def _ease(a: float, b: float, frames: int) -> list[float]:
    """Cosine-eased ramp from a to b over `frames` points (excludes the start)."""
    return [a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * (i / frames))) for i in range(1, frames + 1)]


def _wave(n: int, top: float, bottom: float, phase: int = 8, pause: int = 0) -> list[float]:
    seq = [top]
    for _ in range(n):
        seq += _ease(top, bottom, phase)
        seq += [bottom] * pause
        seq += _ease(bottom, top, phase)
    return seq


def _front_view_squats(n: int, depth_ratio: float = 0.5, pause: int = 0) -> list[tuple[float, float]]:
    """(knee_angle, hip_height) per frame for squats filmed head-on.

    The knee angle only drifts 172 -> 160 (knees travel toward the camera), while
    the hips fall from 0.40 to depth_ratio * 0.40 of the frame height.
    """
    knees = _wave(n, 172.0, 160.0, pause=pause)
    heights = _wave(n, 0.40, 0.40 * depth_ratio, pause=pause)
    return list(zip(knees, heights, strict=True))


def _feed(counter: RepCounter, frames: list[tuple[float, float | None]]) -> int:
    last = 0
    for knee, height in frames:
        last = counter.update({j: knee for j in _KNEES}, hip_height=height)
    return last


# --- hip-drop machine ------------------------------------------------------


def test_front_view_squats_count_via_hip_drop() -> None:
    assert _feed(RepCounter("squat"), _front_view_squats(5)) == 5


def test_front_view_squats_did_not_count_on_knee_angle_alone() -> None:
    # The pre-fix behaviour, pinned so the root cause stays documented.
    frames: list[tuple[float, float | None]] = [(k, None) for k, _ in _front_view_squats(5)]
    assert _feed(RepCounter("squat"), frames) == 0


def test_front_view_lunges_count_via_hip_drop() -> None:
    assert _feed(RepCounter("lunge"), _front_view_squats(4, depth_ratio=0.55)) == 4


def test_paused_squats_still_count() -> None:
    # A 2 s pause at the bottom (30 frames @ 15 fps) must not drift the standing
    # reference so far that the rep is lost.
    assert _feed(RepCounter("squat"), _front_view_squats(3, pause=30)) == 3


def test_quarter_squats_not_counted() -> None:
    # Hips only dropping to 85% of standing height is not a rep.
    assert _feed(RepCounter("squat"), _front_view_squats(4, depth_ratio=0.85)) == 0


def test_standing_jitter_not_counted() -> None:
    frames: list[tuple[float, float | None]] = [(172.0, 0.40 + (0.01 if i % 2 else -0.01)) for i in range(200)]
    assert _feed(RepCounter("squat"), frames) == 0


def test_hip_and_knee_signals_do_not_double_count() -> None:
    # Side view: knee AND hip-drop both see every rep — count is max, not sum.
    knees = _wave(4, 178.0, 72.0)
    heights = _wave(4, 0.40, 0.20)
    frames: list[tuple[float, float | None]] = list(zip(knees, heights, strict=True))
    assert _feed(RepCounter("squat"), frames) == 4


def test_walking_closer_to_camera_mid_set_still_counts() -> None:
    # The lifter appears larger after stepping in: the running-max reference
    # rescales instantly instead of reading the bigger body as "standing taller".
    far = _front_view_squats(2)
    near = [(k, h * 1.3) for k, h in _front_view_squats(2)]
    assert _feed(RepCounter("squat"), far + near) == 4


def test_hip_drop_ignored_for_non_squat_exercises() -> None:
    counter = RepCounter("curl")
    for h in _wave(5, 0.40, 0.20):
        counter.update({"left_elbow_angle": 160.0, "right_elbow_angle": 160.0}, hip_height=h)
    assert counter.count == 0


def test_hip_drop_state_reports_down_mid_rep() -> None:
    counter = RepCounter("squat")
    for k, h in _front_view_squats(1)[:9]:  # descend to the bottom only
        counter.update({j: k for j in _KNEES}, hip_height=h)
    assert counter.state == "down"


def test_reset_clears_hip_drop_count() -> None:
    counter = RepCounter("squat")
    _feed(counter, _front_view_squats(3))
    counter.reset()
    assert counter.count == 0
    assert _feed(counter, _front_view_squats(2)) == 2


def test_hip_drop_deterministic() -> None:
    frames = _front_view_squats(6)
    assert _feed(RepCounter("squat"), frames) == _feed(RepCounter("squat"), frames)


# --- hip_height ------------------------------------------------------------


def _kp_with(hip_y: float, ankle_y: float) -> np.ndarray:
    kp = np.full((17, 2), 0.5)
    kp[[LEFT_HIP, RIGHT_HIP], 1] = hip_y
    kp[[LEFT_ANKLE, RIGHT_ANKLE], 1] = ankle_y
    return kp


def test_hip_height_is_ankle_minus_hip() -> None:
    assert hip_height(_kp_with(0.5, 0.9), np.ones(17)) == pytest.approx(0.4)


def test_hip_height_uses_the_visible_side_only() -> None:
    kp = _kp_with(0.5, 0.9)
    kp[RIGHT_HIP, 1] = 0.0  # wrong, but its confidence is below the gate
    conf = np.ones(17)
    conf[RIGHT_HIP] = 0.0
    assert hip_height(kp, conf) == pytest.approx(0.4)


def test_hip_height_none_when_ankles_hidden() -> None:
    conf = np.ones(17)
    conf[[LEFT_ANKLE, RIGHT_ANKLE]] = 0.0
    assert hip_height(_kp_with(0.5, 0.9), conf) is None


def test_hip_height_none_when_hips_below_ankles() -> None:
    assert hip_height(_kp_with(0.9, 0.5), np.ones(17)) is None


# --- aspect-correct angles -------------------------------------------------


def test_portrait_frame_angle_is_distorted_without_aspect_and_fixed_with_it() -> None:
    # True 45 degree angle in pixels on a 360x640 portrait frame.
    w, h = 360.0, 640.0
    a_px, b_px, c_px = (100.0, 100.0), (0.0, 0.0), (100.0, 0.0)
    kp = np.zeros((17, 2))
    from app.analysis.keypoint_utils import LEFT_ANKLE as C
    from app.analysis.keypoint_utils import LEFT_HIP as A
    from app.analysis.keypoint_utils import LEFT_KNEE as B

    for idx, (x, y) in ((A, a_px), (B, b_px), (C, c_px)):
        kp[idx] = (x / w, y / h)
    conf = np.ones(17)

    distorted = compute_angles(kp, conf)["left_knee_angle"]
    corrected = compute_angles(kp, conf, aspect=w / h)["left_knee_angle"]

    assert distorted is not None and corrected is not None
    assert abs(distorted - 45.0) > 10.0  # the bug: ~29 degrees
    assert corrected == pytest.approx(45.0, abs=1e-6)


def test_aspect_one_is_a_noop() -> None:
    rng = np.random.default_rng(0)
    kp = rng.random((17, 2))
    conf = np.ones(17)
    assert compute_angles(kp, conf) == compute_angles(kp, conf, aspect=1.0)


def test_aspect_does_not_mutate_caller_keypoints() -> None:
    kp = np.full((17, 2), 0.5)
    before = kp.copy()
    compute_angles(kp, np.ones(17), aspect=0.5625)
    assert np.array_equal(kp, before)


def test_compute_angle_sanity() -> None:
    assert compute_angle(np.array([1.0, 0.0]), np.array([0.0, 0.0]), np.array([0.0, 1.0])) == pytest.approx(90.0)
