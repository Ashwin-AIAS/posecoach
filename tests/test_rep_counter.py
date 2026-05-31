"""Streaming rep counter — deterministic flex→extend cycle counting."""
from __future__ import annotations

import pytest

from app.analysis.rep_counter import RepCounter


def _feed(counter: RepCounter, joints: list[str], angles: list[float]) -> int:
    """Feed a sequence of (uniform across joints) angle values; return final count."""
    last = 0
    for a in angles:
        last = counter.update({j: a for j in joints})
    return last


# Squat oscillates the knees; deep enough to cross both hysteresis thresholds.
_SQUAT_JOINTS = ["left_knee_angle", "right_knee_angle"]


def _rep_wave(n: int, top: float = 175.0, bottom: float = 80.0) -> list[float]:
    """n full reps: start extended, dip to `bottom`, return to `top`, repeat."""
    seq = [top]
    for _ in range(n):
        seq += [bottom, top]
    return seq


def test_counts_full_reps() -> None:
    counter = RepCounter("squat")
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(5)) == 5


def test_starts_at_zero() -> None:
    assert RepCounter("squat").count == 0


def test_shallow_reps_not_counted() -> None:
    # Dipping only to 120° never crosses the squat "down" threshold (~103°).
    counter = RepCounter("squat")
    assert _feed(counter, _SQUAT_JOINTS, [175.0, 120.0, 175.0, 120.0, 175.0]) == 0


def test_deterministic_same_sequence_same_count() -> None:
    seq = _rep_wave(7)
    c1, c2 = RepCounter("squat"), RepCounter("squat")
    assert _feed(c1, _SQUAT_JOINTS, seq) == _feed(c2, _SQUAT_JOINTS, seq)


def test_occluded_frames_hold_state() -> None:
    counter = RepCounter("squat")
    # Go down, drop out (all joints occluded), come back up → still one clean rep.
    counter.update({"left_knee_angle": 175.0, "right_knee_angle": 175.0})
    counter.update({"left_knee_angle": 80.0, "right_knee_angle": 80.0})
    counter.update({"left_knee_angle": None, "right_knee_angle": None})
    final = counter.update({"left_knee_angle": 175.0, "right_knee_angle": 175.0})
    assert final == 1


def test_plank_never_counts() -> None:
    counter = RepCounter("plank")
    assert _feed(counter, ["left_hip_angle", "right_hip_angle"], _rep_wave(4)) == 0


def test_reset_clears_count() -> None:
    counter = RepCounter("squat")
    _feed(counter, _SQUAT_JOINTS, _rep_wave(3))
    counter.reset()
    assert counter.count == 0
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(2)) == 2


@pytest.mark.parametrize("exercise", ["curl", "bench", "deadlift", "lateral_raise", "one_arm_row"])
def test_other_exercises_count_with_their_joints(exercise: str) -> None:
    from app.analysis.rep_counter import _REP_JOINTS

    joints = _REP_JOINTS[exercise]
    counter = RepCounter(exercise)
    # Use each joint's blended range to build a wave guaranteed to cross thresholds.
    assert counter._down_thr is not None and counter._up_thr is not None
    bottom = counter._down_thr - 5.0
    top = counter._up_thr + 5.0
    seq = [top]
    for _ in range(3):
        seq += [bottom, top]
    assert _feed(counter, joints, seq) == 3
