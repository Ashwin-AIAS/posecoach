"""Streaming rep counter — online hysteresis machine with realistic curves.

The live counter EMA-smooths each joint angle, so sharp two-frame waves are not
representative. These tests drive it with gradual (cosine-eased) rep curves like
a real lifter produces, plus noisy / shallow / double-bounce variants.
"""
from __future__ import annotations

import math

import pytest

from app.analysis.form_scorer import joint_range
from app.analysis.rep_counter import REP_SIGNAL, RepCounter

_SQUAT_JOINTS = ["left_knee_angle", "right_knee_angle"]


def _ease(a: float, b: float, frames: int) -> list[float]:
    """Cosine-eased ramp from a to b over `frames` points (excludes the start)."""
    return [a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * (i / frames))) for i in range(1, frames + 1)]


def _rep_wave(n: int, top: float = 178.0, bottom: float = 72.0, phase: int = 8) -> list[float]:
    """n gradual reps: start extended, ease to `bottom`, ease back to `top`."""
    seq = [top]
    for _ in range(n):
        seq += _ease(top, bottom, phase)
        seq += _ease(bottom, top, phase)
    return seq


def _feed(counter: RepCounter, joints: list[str], angles: list[float]) -> int:
    last = 0
    for a in angles:
        last = counter.update({j: a for j in joints})
    return last


def test_counts_full_reps() -> None:
    counter = RepCounter("squat")
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(5)) == 5


def test_starts_at_zero() -> None:
    assert RepCounter("squat").count == 0


def test_shallow_reps_not_counted() -> None:
    # Dipping only to 130 never reaches the squat down threshold (~103 deg).
    counter = RepCounter("squat")
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(4, bottom=130.0)) == 0


def test_noisy_reps_still_count() -> None:
    # Add a deterministic +/- jitter on top of clean reps — count is unchanged.
    counter = RepCounter("squat")
    clean = _rep_wave(6)
    noisy = [a + (3.0 if i % 2 else -3.0) for i, a in enumerate(clean)]
    assert _feed(counter, _SQUAT_JOINTS, noisy) == 6


def test_bottom_bounce_not_double_counted() -> None:
    # Descend, bounce back up to mid-range (not past the up threshold), descend
    # again, then finish the rep -> exactly one rep, not two.
    counter = RepCounter("squat")
    seq = [178.0]
    seq += _ease(178.0, 72.0, 8)  # down
    seq += _ease(72.0, 120.0, 5)  # partial bounce up (stays below up threshold)
    seq += _ease(120.0, 72.0, 5)  # back down
    seq += _ease(72.0, 178.0, 8)  # up — completes the single rep
    assert _feed(counter, _SQUAT_JOINTS, seq) == 1


def test_micro_bounce_at_top_rejected_by_cadence() -> None:
    # A clean rep, then a tiny rapid full flick — the cadence/amplitude guards
    # keep the flick from registering as a second rep.
    counter = RepCounter("squat")
    seq = _rep_wave(1)
    seq += [72.0, 178.0]  # 2-frame flick — too fast and EMA-flattened to count
    assert _feed(counter, _SQUAT_JOINTS, seq) == 1


def test_deterministic_same_sequence_same_count() -> None:
    seq = _rep_wave(7)
    c1, c2 = RepCounter("squat"), RepCounter("squat")
    assert _feed(c1, _SQUAT_JOINTS, seq) == _feed(c2, _SQUAT_JOINTS, seq)


def test_occluded_frames_hold_state() -> None:
    counter = RepCounter("squat")
    # One clean rep with a dropout (all joints occluded) mid-descent.
    seq_down = _ease(178.0, 72.0, 8)
    counter.update({"left_knee_angle": 178.0, "right_knee_angle": 178.0})
    for a in seq_down[:4]:
        counter.update({"left_knee_angle": a, "right_knee_angle": a})
    counter.update({"left_knee_angle": None, "right_knee_angle": None})  # dropout
    for a in seq_down[4:]:
        counter.update({"left_knee_angle": a, "right_knee_angle": a})
    final = 0
    for a in _ease(72.0, 178.0, 8):
        final = counter.update({"left_knee_angle": a, "right_knee_angle": a})
    assert final == 1


def test_unilateral_one_arm_row_counts_off_working_side() -> None:
    # The bench-supporting arm is static; only the working arm sweeps. The max-of-
    # machines design must still count the reps off the working side.
    counter = RepCounter("one_arm_row")
    lo_w, hi_w = 55.0, 168.0  # working (right) elbow sweep
    static = 165.0  # supporting (left) elbow barely moves
    last = 0
    for _ in range(4):
        for a in _ease(hi_w, lo_w, 8):
            last = counter.update({"right_elbow_angle": a, "left_elbow_angle": static})
        for a in _ease(lo_w, hi_w, 8):
            last = counter.update({"right_elbow_angle": a, "left_elbow_angle": static})
    assert last == 4


def test_plank_never_counts() -> None:
    counter = RepCounter("plank")
    assert _feed(counter, ["left_hip_angle", "right_hip_angle"], _rep_wave(4)) == 0


def test_reset_clears_count() -> None:
    counter = RepCounter("squat")
    _feed(counter, _SQUAT_JOINTS, _rep_wave(3))
    counter.reset()
    assert counter.count == 0
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(2)) == 2


@pytest.mark.parametrize("exercise", ["curl", "bench", "deadlift", "lateral_raise", "ohp"])
def test_other_exercises_count_with_their_joints(exercise: str) -> None:
    joints = list(REP_SIGNAL[exercise].primary)
    counter = RepCounter(exercise)
    # Drive each primary joint across its own [p5, p95] range with gradual curves.
    per_joint = {j: r for j in joints if (r := joint_range(exercise, j)) is not None}
    assert per_joint, f"{exercise} should have at least one ranged primary joint"
    last = 0
    for _ in range(3):
        for frac in [0.5 - 0.5 * math.cos(math.pi * (i / 8)) for i in range(1, 9)]:
            last = counter.update({j: hi - (hi - lo) * frac for j, (lo, hi) in per_joint.items()})
        for frac in [0.5 - 0.5 * math.cos(math.pi * (i / 8)) for i in range(1, 9)]:
            last = counter.update({j: lo + (hi - lo) * frac for j, (lo, hi) in per_joint.items()})
    assert last == 3
