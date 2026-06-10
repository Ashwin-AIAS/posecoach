from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from statistics import median

from app.analysis.form_scorer import joint_percentiles, joint_range

# Rolling window of recent frames the verifier reasons over (~6s at 15 fps) and
# the minimum it needs before it will ever return a non-trivial verdict.
_WINDOW_FRAMES = 90
_MIN_FRAMES = 24
# A "mover" joint must sweep at least this fraction of its Fit3D range to count
# as actually performing the movement.
_MOVER_ROM_FRAC = 0.30
# A "must-also-move" joint (deadlift knee) sweeping below this fraction of its
# range while the hinge works means it is the hinge-only variant (an RDL).
_ALSO_MOVE_FRAC = 0.25
# The window must contain at least this much motion *somewhere* before we judge —
# below it the lifter is setting up / standing still, not doing the wrong thing.
_ACTIVITY_MIN_DEG = 18.0
# How far above a joint's p95 the median posture may sit before the torso reads
# as too upright / supported for a bent-over row.
_UPRIGHT_TOL_DEG = 8.0
# WS acts on a mismatch only once the verdict carries at least this confidence.
MIN_VERDICT_CONFIDENCE = 0.4


@dataclass(frozen=True)
class VerificationResult:
    """Whether the observed movement matches the chosen exercise.

    ``confidence`` rises with how much of the window has filled (0 until enough
    frames). ``detected_hint`` is a plain-English cue (<= 8 words) only when
    ``verified`` is False.
    """

    verified: bool
    confidence: float
    detected_hint: str | None = None


@dataclass(frozen=True)
class ExerciseSignature:
    """Interpretable movement signature for an exercise (no black-box model).

    Magnitudes are sourced from ``angle_ranges.json`` at runtime — this only
    names which joints carry which role.
    """

    # At least one mover must sweep its range (handles unilateral lifts).
    movers: tuple[str, ...]
    # Joints that must ALSO move, else it is a hinge-only variant (deadlift knee).
    also_move: tuple[str, ...] = ()
    also_move_hint: str = ""
    # Torso joints that must stay hinged (bent-over rows) — too upright => flag.
    upright_limit: tuple[str, ...] = ()
    upright_hint: str = ""
    # Cue when the movers simply are not moving while something else is.
    absent_hint: str = "Doesn't match the exercise"


_ELBOWS = ("left_elbow_angle", "right_elbow_angle")
_KNEES = ("left_knee_angle", "right_knee_angle")
_HIPS = ("left_hip_angle", "right_hip_angle")
_SHOULDERS = ("left_shoulder_angle", "right_shoulder_angle")

# Verification signatures. Only exercises where a wrong-movement is plausible and
# detectable carry special rules; the rest just require their movers to move.
EXERCISE_SIGNATURES: dict[str, ExerciseSignature] = {
    "squat": ExerciseSignature(_KNEES, absent_hint="Bend your knees to squat"),
    "lunge": ExerciseSignature(_KNEES, absent_hint="Step into a lunge"),
    "deadlift": ExerciseSignature(
        _HIPS,
        also_move=_KNEES,
        also_move_hint="Looks like RDL — pick RDL",
        absent_hint="Hinge at your hips to pull",
    ),
    "bench": ExerciseSignature(_ELBOWS, absent_hint="Press with your arms"),
    "pushup": ExerciseSignature(_ELBOWS, absent_hint="Bend your elbows to press"),
    "diamond_pushup": ExerciseSignature(_ELBOWS, absent_hint="Bend your elbows to press"),
    "ohp": ExerciseSignature(_ELBOWS, absent_hint="Press overhead"),
    "db_shoulder_press": ExerciseSignature(_ELBOWS, absent_hint="Press overhead"),
    "curl": ExerciseSignature(_ELBOWS, absent_hint="Curl with your elbows"),
    "hammer_curl": ExerciseSignature(_ELBOWS, absent_hint="Curl with your elbows"),
    "drag_curl": ExerciseSignature(_ELBOWS, absent_hint="Curl with your elbows"),
    "barbell_row": ExerciseSignature(
        _ELBOWS,
        upright_limit=_HIPS,
        upright_hint="Hinge over for a barbell row",
        absent_hint="Pull with your elbows to row",
    ),
    "one_arm_row": ExerciseSignature(
        _ELBOWS,
        upright_limit=_HIPS,
        upright_hint="Hinge over the bench to row",
        absent_hint="Pull with your elbow to row",
    ),
    "lateral_raise": ExerciseSignature(
        _SHOULDERS,
        absent_hint="Raise your arms out wide",
    ),
    "shrug": ExerciseSignature(
        _SHOULDERS,
        absent_hint="Shrug your shoulders up",
    ),
    "front_raise": ExerciseSignature(
        _SHOULDERS,
        absent_hint="Raise your arms forward",
    ),
    "overhead_triceps": ExerciseSignature(
        _ELBOWS,
        absent_hint="Extend your elbows overhead",
    ),
    # plank: isometric — no movement signature to verify.
}


def _rom_and_median(window: list[Mapping[str, float | None]]) -> dict[str, tuple[float, float]]:
    """Per-joint (range-of-motion, median angle) over the window's present values."""
    collected: dict[str, list[float]] = {}
    for frame in window:
        for joint, value in frame.items():
            if value is not None:
                collected.setdefault(joint, []).append(value)
    out: dict[str, tuple[float, float]] = {}
    for joint, values in collected.items():
        if values:
            out[joint] = (max(values) - min(values), float(median(values)))
    return out


def _expected_rom(exercise: str, joint: str) -> float:
    r = joint_range(exercise, joint)
    return (r[1] - r[0]) if r is not None else 0.0


def classify(exercise: str, window: list[Mapping[str, float | None]]) -> VerificationResult:
    """Decide whether `window` of joint angles matches the chosen exercise.

    Conservative by design: it only flags a mismatch when there is clear activity
    that contradicts the exercise's signature, so a correct (even sloppy) rep is
    never rejected. Returns ``verified=True`` with low confidence while idle or
    under-sampled.
    """
    sig = EXERCISE_SIGNATURES.get(exercise)
    if sig is None:
        return VerificationResult(True, 0.0, None)

    n = len(window)
    confidence = min(1.0, n / _WINDOW_FRAMES)
    if n < _MIN_FRAMES:
        return VerificationResult(True, confidence, None)

    rom = _rom_and_median(window)
    activity = max((r for r, _m in rom.values()), default=0.0)
    if activity < _ACTIVITY_MIN_DEG:
        # Standing still / setup — not enough motion to judge the movement.
        return VerificationResult(True, confidence * 0.4, None)

    movers_moving = any(
        rom.get(j, (0.0, 0.0))[0] >= _MOVER_ROM_FRAC * exp
        for j in sig.movers
        if (exp := _expected_rom(exercise, j)) > 0.0
    )

    # Hinge-only variant (deadlift chosen, knees static -> RDL).
    if movers_moving and sig.also_move:
        knee_quiet = all(
            rom.get(j, (0.0, 0.0))[0] < _ALSO_MOVE_FRAC * exp
            for j in sig.also_move
            if (exp := _expected_rom(exercise, j)) > 0.0
        )
        if knee_quiet:
            return VerificationResult(False, confidence, sig.also_move_hint)

    # Torso too upright / supported for a bent-over row.
    if sig.upright_limit:
        for j in sig.upright_limit:
            pct = joint_percentiles(exercise, j)
            if pct is None or j not in rom:
                continue
            if rom[j][1] > pct["p95"] + _UPRIGHT_TOL_DEG:
                return VerificationResult(False, confidence, sig.upright_hint)

    # Activity present but the exercise's movers are not the ones moving.
    if not movers_moving:
        return VerificationResult(False, confidence, sig.absent_hint)

    return VerificationResult(True, confidence, None)


class ExerciseVerifier:
    """Streaming wrapper around :func:`classify` for the live WS loop.

    One instance per WebSocket connection; call :meth:`reset` on disconnect or
    exercise change. Holds a bounded rolling window of recent joint angles.
    """

    def __init__(self, exercise: str) -> None:
        self.exercise = exercise
        self._window: deque[Mapping[str, float | None]] = deque(maxlen=_WINDOW_FRAMES)

    def update(self, angles: Mapping[str, float | None]) -> VerificationResult:
        """Feed one frame's joint angles; return the current verdict."""
        self._window.append(dict(angles))
        return classify(self.exercise, list(self._window))

    def reset(self) -> None:
        self._window.clear()
