"""Exercise-verification gate (P13) — reject wrong-exercise scoring.

The verifier reasons over a window of joint angles (the post-compute_angles
representation of a keypoint sequence) and decides whether the movement matches
the chosen exercise, with interpretable biomechanical rules.
"""
from __future__ import annotations

import math

from app.analysis.exercise_verifier import (
    ExerciseVerifier,
    classify,
)
from app.analysis.form_scorer import joint_range


def _ease(a: float, b: float, frames: int) -> list[float]:
    return [a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * (i / frames))) for i in range(1, frames + 1)]


def _sweep(top: float, bottom: float, reps: int, phase: int = 8) -> list[float]:
    seq = [top]
    for _ in range(reps):
        seq += _ease(top, bottom, phase)
        seq += _ease(bottom, top, phase)
    return seq


def _two_joint_window(
    j1: str, s1: list[float], j2: str, s2: list[float]
) -> list[dict[str, float | None]]:
    """Build a window with both sides of two joint families set to the series."""
    return [
        {
            f"left_{j1}": v1,
            f"right_{j1}": v1,
            f"left_{j2}": v2,
            f"right_{j2}": v2,
        }
        for v1, v2 in zip(s1, s2, strict=False)
    ]


def test_correct_deadlift_is_verified() -> None:
    lo_h, hi_h = joint_range("deadlift", "left_hip_angle") or (63.0, 156.0)
    lo_k, hi_k = joint_range("deadlift", "left_knee_angle") or (116.0, 179.0)
    win = _two_joint_window("hip_angle", _sweep(hi_h, lo_h, 3), "knee_angle", _sweep(hi_k, lo_k, 3))
    res = classify("deadlift", win)
    assert res.verified is True
    assert res.detected_hint is None


def test_rdl_with_chosen_deadlift_flags_rdl() -> None:
    # Hip hinges fully; knees stay near-locked (the RDL signature).
    lo_h, hi_h = joint_range("deadlift", "left_hip_angle") or (63.0, 156.0)
    hip = _sweep(hi_h, lo_h, 3)
    knee = [176.0] * len(hip)
    win = _two_joint_window("hip_angle", hip, "knee_angle", knee)
    res = classify("deadlift", win)
    assert res.verified is False
    assert res.detected_hint is not None
    assert "RDL" in res.detected_hint


def test_correct_barbell_row_is_verified() -> None:
    # Bent-over hinge (~110 deg hip) with the elbows pulling.
    hip = [110.0 + (4.0 if i % 2 else -4.0) for i in range(60)]
    elbow = _sweep(165.0, 60.0, 3)
    win = _two_joint_window("hip_angle", hip, "elbow_angle", elbow)
    assert classify("barbell_row", win).verified is True


def test_chest_supported_machine_with_chosen_row_flags_mismatch() -> None:
    # Torso held upright (~172 deg hip) — supported/seated machine, not a free row.
    hip = [172.0 + (3.0 if i % 2 else -3.0) for i in range(60)]
    elbow = _sweep(165.0, 60.0, 3)
    win = _two_joint_window("hip_angle", hip, "elbow_angle", elbow)
    res = classify("barbell_row", win)
    assert res.verified is False
    assert res.detected_hint is not None
    assert len(res.detected_hint.split()) <= 8


def test_wrong_exercise_curling_while_squat_chosen_flags_absent() -> None:
    knee = [178.0] * 60  # legs locked out
    elbow = _sweep(165.0, 40.0, 3)  # arms doing the work
    win = _two_joint_window("knee_angle", knee, "elbow_angle", elbow)
    res = classify("squat", win)
    assert res.verified is False
    assert res.detected_hint is not None


def test_squat_motion_while_front_raise_chosen_flags_absent() -> None:
    # Knees drive a squat-like sweep while the shoulders — the front-raise movers —
    # stay put: real activity is present, but the wrong joints are moving.
    knee = _sweep(178.0, 80.0, 3)
    shoulder = [30.0] * len(knee)  # arms held down, not raising
    win = _two_joint_window("knee_angle", knee, "shoulder_angle", shoulder)
    res = classify("front_raise", win)
    assert res.verified is False
    assert res.detected_hint is not None
    assert len(res.detected_hint.split()) <= 8


def test_correct_front_raise_is_verified() -> None:
    # Shoulders sweep their range (the front-raise mover); knees stay locked.
    lo_s, hi_s = joint_range("front_raise", "left_shoulder_angle") or (53.0, 142.0)
    shoulder = _sweep(hi_s, lo_s, 3)
    knee = [178.0] * len(shoulder)
    win = _two_joint_window("shoulder_angle", shoulder, "knee_angle", knee)
    assert classify("front_raise", win).verified is True


def test_idle_standing_is_not_flagged() -> None:
    win: list[dict[str, float | None]] = [
        {"left_knee_angle": 178.0, "right_knee_angle": 178.0} for _ in range(60)
    ]
    assert classify("squat", win).verified is True


def test_under_min_frames_does_not_judge() -> None:
    win = _two_joint_window("knee_angle", _sweep(178.0, 80.0, 1)[:10], "hip_angle", [120.0] * 10)
    res = classify("squat", win)
    assert res.verified is True


def test_plank_has_no_signature_always_verified() -> None:
    win: list[dict[str, float | None]] = [{"left_hip_angle": 175.0} for _ in range(60)]
    assert classify("plank", win).verified is True


def test_streaming_verifier_reaches_verdict_and_resets() -> None:
    verifier = ExerciseVerifier("deadlift")
    lo_h, hi_h = joint_range("deadlift", "left_hip_angle") or (63.0, 156.0)
    hip = _sweep(hi_h, lo_h, 3)
    last = None
    for h in hip:
        last = verifier.update(
            {"left_hip_angle": h, "right_hip_angle": h, "left_knee_angle": 176.0, "right_knee_angle": 176.0}
        )
    assert last is not None and last.verified is False  # RDL signature detected
    verifier.reset()
    fresh = verifier.update({"left_hip_angle": 120.0, "right_hip_angle": 120.0})
    assert fresh.verified is True  # window cleared — not enough data to judge
