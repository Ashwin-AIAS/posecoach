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
    from app.analysis.form_scorer import joint_range
    from app.analysis.rep_counter import REP_SIGNAL

    joints = list(REP_SIGNAL[exercise].primary)
    counter = RepCounter(exercise)
    # Drive each primary joint across ITS OWN [p5, p95] range (per-joint machines)
    # so unilateral lifts like one_arm_row, where the two sides differ wildly,
    # still complete a full cycle on the working side.
    per_joint = {j: r for j in joints if (r := joint_range(exercise, j)) is not None}
    assert per_joint, f"{exercise} should have at least one ranged primary joint"
    last = 0
    for _ in range(3):
        last = counter.update({j: hi for j, (_lo, hi) in per_joint.items()})  # extended
        last = counter.update({j: lo for j, (lo, _hi) in per_joint.items()})  # flexed
    last = counter.update({j: hi for j, (_lo, hi) in per_joint.items()})  # back to extended
    assert last == 3
