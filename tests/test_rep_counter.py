"""Streaming rep counter — online hysteresis machine with realistic curves.

The live counter EMA-smooths each joint angle, so sharp two-frame waves are not
representative. These tests drive it with gradual (cosine-eased) rep curves like
a real lifter produces, plus noisy / shallow / double-bounce variants.
"""

from __future__ import annotations

import math

import pytest

from app.analysis.form_scorer import joint_range
from app.analysis.rep_counter import MAX_BRIDGE_FRAMES, REP_SIGNAL, RepCounter

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


def test_plank_is_isometric_hold_unaffected_by_rep_machine() -> None:
    # Plank has no REP_SIGNAL entry -> no machines -> hold timer, never reps.
    counter = RepCounter("plank")
    assert counter.down_thr is None and counter.up_thr is None
    assert counter.tracked_joints == []
    assert counter.state == "hold"
    # Even a full hip oscillation must not accumulate a single rep.
    _feed(counter, ["left_hip_angle", "right_hip_angle"], _rep_wave(6))
    assert counter.count == 0
    assert counter.state == "hold"


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


def test_fast_tempo_reps_no_longer_flattened_by_lag() -> None:
    # A fast, borderline-deep squat (bottom=95, just past the down threshold of
    # ~103) at a rushed phase=4 tempo: the old fixed EMA(alpha=0.6) flattens
    # this enough that the smoothed trough never travels far enough for the
    # amplitude guard, missing every rep (verified offline: 0/5 with the old
    # smoother). The speed-adaptive OneEuroFilter (pillar A) tracks the true
    # trough closely enough that all 5 genuine reps count.
    counter = RepCounter("squat")
    assert _feed(counter, _SQUAT_JOINTS, _rep_wave(5, bottom=95.0, phase=4)) == 5


def test_mid_rep_dropout_within_bridge_limit_still_counts() -> None:
    # A dropout of exactly MAX_BRIDGE_FRAMES, landing right at the descent —
    # pillar C holds the last smoothed value through the gap instead of
    # silently skipping, so the trough is never lost.
    counter = RepCounter("squat")
    down = _ease(178.0, 72.0, 8)
    up = _ease(72.0, 178.0, 8)
    last = 0
    counter.update({j: 178.0 for j in _SQUAT_JOINTS})
    for a in down[:4]:
        last = counter.update({j: a for j in _SQUAT_JOINTS})
    for _ in range(MAX_BRIDGE_FRAMES):
        last = counter.update({j: None for j in _SQUAT_JOINTS})
    for a in down[4:]:
        last = counter.update({j: a for j in _SQUAT_JOINTS})
    for a in up:
        last = counter.update({j: a for j in _SQUAT_JOINTS})
    assert last == 1


def test_dropout_longer_than_bridge_does_not_invent_a_rep() -> None:
    # A dropout well past MAX_BRIDGE_FRAMES, immediately followed by a 2-frame
    # flick (the same shape rejected in test_micro_bounce_at_top_rejected_by_
    # cadence). If a long gap were bridged indefinitely it would keep crediting
    # `_frames_since_rep` for frames that were never actually observed, letting
    # the flick slip past the cadence guard on a stale hold. Freezing state
    # beyond the bridge limit means the long gap contributes nothing once it
    # exceeds MAX_BRIDGE_FRAMES, so the flick is still correctly rejected.
    counter = RepCounter("squat")
    last = _feed(counter, _SQUAT_JOINTS, _rep_wave(1))
    assert last == 1
    for _ in range(MAX_BRIDGE_FRAMES + 10):
        last = counter.update({j: None for j in _SQUAT_JOINTS})
    for a in [72.0, 178.0]:
        last = counter.update({j: a for j in _SQUAT_JOINTS})
    assert last == 1


def test_reduced_rom_user_counts_after_threshold_calibration() -> None:
    # Rep 1 dips deep enough (95 deg) to cross the fixed Fit3D-prior down
    # threshold (~103 deg) and complete normally, which calibrates the
    # adaptive thresholds (pillar B) onto this user's own observed range.
    # Reps 2-5 only dip to 110 deg — shallower than the *original* fixed
    # threshold, which would reject them outright (mirrors
    # test_shallow_reps_not_counted's 130-deg case) — but the recentred
    # band, narrowed onto the calibrating rep's actual depth, now accepts
    # them. A genuine shallow partial that never calibrates (130 deg, the
    # existing test above) must still count zero.
    counter = RepCounter("squat")
    seq = [178.0]
    seq += _ease(178.0, 95.0, 8) + _ease(95.0, 178.0, 8)
    for _ in range(4):
        seq += _ease(178.0, 110.0, 8) + _ease(110.0, 178.0, 8)
    assert _feed(counter, _SQUAT_JOINTS, seq) == 5


@pytest.mark.parametrize("exercise", ["shrug", "front_raise", "overhead_triceps"])
def test_p15_exercises_count_full_reps(exercise: str) -> None:
    # P15: oscillate each PRIMARY joint across its own Fit3D [p5, p95] for 5 reps.
    # Ranges are read via joint_range (never hardcoded degrees) to stay locked to
    # angle_ranges.json. This is the shrug decision test (section 2): the full-
    # range sweep clears the amplitude guard, so no per-exercise ROM override is
    # needed for the synthetic benchmark.
    joints = list(REP_SIGNAL[exercise].primary)
    per_joint = {j: r for j in joints if (r := joint_range(exercise, j)) is not None}
    assert per_joint, f"{exercise} should have at least one ranged primary joint"
    counter = RepCounter(exercise)
    last = 0
    for _ in range(5):
        for frac in [0.5 - 0.5 * math.cos(math.pi * (i / 8)) for i in range(1, 9)]:
            last = counter.update({j: hi - (hi - lo) * frac for j, (lo, hi) in per_joint.items()})
        for frac in [0.5 - 0.5 * math.cos(math.pi * (i / 8)) for i in range(1, 9)]:
            last = counter.update({j: lo + (hi - lo) * frac for j, (lo, hi) in per_joint.items()})
    assert last == 5
