from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.analysis.form_scorer import joint_range


@dataclass(frozen=True)
class RepSignal:
    """The joint-angle signal that defines one rep of an exercise.

    ``primary`` joints drive the count: each runs its own hysteresis state
    machine and the rep count is the *max* across them. Taking the max (not the
    average) is what makes unilateral lifts work — on a one-arm row the
    bench-supporting arm is static (~30° ROM) while the working arm sweeps the
    full range, so averaging would halve the signal, but the max simply follows
    whichever limb is actually doing the rep. For bilateral lifts both sides
    cycle together and the max equals either side.

    ``secondary`` joints are biomechanical context (e.g. knee flexion on a
    deadlift, shoulder/torso on a row). They do not drive the count; they are
    surfaced for the P13 exercise-verification gate.
    """

    primary: tuple[str, ...]
    secondary: tuple[str, ...] = ()


# Per-exercise rep signal. The driving joint is chosen for the movement, not a
# one-size-fits-all knee angle: hinges count off the hip, presses/curls/rows off
# the elbow, raises off the shoulder. Plank is omitted — it is isometric and
# uses the hold timer, never the rep machine.
REP_SIGNAL: dict[str, RepSignal] = {
    # Lower body — knee flexion drives, hip hinge is context
    "squat": RepSignal(
        ("left_knee_angle", "right_knee_angle"),
        ("left_hip_angle", "right_hip_angle"),
    ),
    "lunge": RepSignal(
        ("left_knee_angle", "right_knee_angle"),
        ("left_hip_angle", "right_hip_angle"),
    ),
    # Hinge — hip angle drives, knee flexion is context (deadlift vs RDL, P13)
    "deadlift": RepSignal(
        ("left_hip_angle", "right_hip_angle"),
        ("left_knee_angle", "right_knee_angle"),
    ),
    # Elbow-driven presses & curls
    "bench": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    "pushup": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    "diamond_pushup": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    "ohp": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    "db_shoulder_press": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    "curl": RepSignal(("left_elbow_angle", "right_elbow_angle")),
    "hammer_curl": RepSignal(("left_elbow_angle", "right_elbow_angle")),
    "drag_curl": RepSignal(("left_elbow_angle", "right_elbow_angle")),
    # Rows — elbow flexion drives, shoulder/torso are context
    "barbell_row": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle", "left_hip_angle", "right_hip_angle"),
    ),
    "one_arm_row": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle", "left_hip_angle", "right_hip_angle"),
    ),
    # Raise — shoulder abduction drives
    "lateral_raise": RepSignal(("left_shoulder_angle", "right_shoulder_angle")),
    # plank: isometric — no rep signal (uses the hold timer instead)
}

# Fraction of the [p5, p95] range used as the hysteresis dead-band on each side.
# A rep requires entering the flexed zone (<= down) then returning to extended
# (>= up); the band stops noise near a single threshold from double-counting.
_HYSTERESIS = 0.30


class _JointRepMachine:
    """Hysteresis rep state machine for a single joint angle.

    Two thresholds derived from the joint's Fit3D ``[p5, p95]`` range with a
    dead-band between them. A rep increments on a full extend -> flex -> extend
    cycle. Streaming and deterministic.
    """

    def __init__(self, lo: float, hi: float) -> None:
        span = hi - lo
        self._down = lo + _HYSTERESIS * span
        self._up = hi - _HYSTERESIS * span
        self._count = 0
        self._state = "up"  # assume the lifter starts extended

    def update(self, angle: float) -> None:
        """Feed one frame's (already side-specific) joint angle."""
        if self._state == "up" and angle <= self._down:
            self._state = "down"
        elif self._state == "down" and angle >= self._up:
            self._state = "up"
            self._count += 1

    @property
    def count(self) -> int:
        return self._count

    @property
    def state(self) -> str:
        return self._state

    @property
    def down_thr(self) -> float:
        return self._down

    @property
    def up_thr(self) -> float:
        return self._up


class RepCounter:
    """Deterministic streaming rep counter for the live inference loop.

    Runs one :class:`_JointRepMachine` per primary joint of the exercise's
    :data:`REP_SIGNAL` and reports the maximum count across them, so bilateral
    and unilateral lifts both count correctly. Streaming (one frame at a time)
    and deterministic: the same angle sequence always yields the same count.

    Isometric exercises (plank) have no rep signal and always report zero.
    """

    def __init__(self, exercise: str) -> None:
        self.exercise = exercise
        signal = REP_SIGNAL.get(exercise)
        self._primary: list[str] = list(signal.primary) if signal is not None else []
        # One machine per primary joint that has a usable Fit3D range.
        self._machines: dict[str, _JointRepMachine] = {}
        for joint in self._primary:
            bounds = joint_range(exercise, joint)
            if bounds is not None:
                lo, hi = bounds
                self._machines[joint] = _JointRepMachine(lo, hi)

    def update(self, angles: Mapping[str, float | None]) -> int:
        """Feed one frame's joint angles; return the running rep count.

        Each tracked joint advances its own machine only when its angle is
        present this frame, so a brief single-joint dropout never miscounts.
        """
        for joint, machine in self._machines.items():
            angle = angles.get(joint)
            if angle is not None:
                machine.update(angle)
        return self.count

    @property
    def count(self) -> int:
        """Reps counted so far — the max across primary-joint machines."""
        if not self._machines:
            return 0
        return max(m.count for m in self._machines.values())

    @property
    def down_thr(self) -> float | None:
        """Mean flexed-zone threshold, or None for isometric exercises.

        Exposed for the WS diagnostics audit (``is_isometric`` derives from it).
        """
        if not self._machines:
            return None
        return sum(m.down_thr for m in self._machines.values()) / len(self._machines)

    @property
    def up_thr(self) -> float | None:
        """Mean extended-zone threshold, or None for isometric exercises."""
        if not self._machines:
            return None
        return sum(m.up_thr for m in self._machines.values()) / len(self._machines)

    @property
    def tracked_joints(self) -> list[str]:
        """Primary rep joints with a usable range (empty for isometric holds)."""
        return list(self._machines.keys())

    @property
    def state(self) -> str:
        """Coarse phase of the rep cycle, for the live overlay.

        ``"hold"`` for isometric exercises; otherwise ``"down"`` if any tracked
        joint is currently flexed, else ``"up"``.
        """
        if not self._machines:
            return "hold"
        if any(m.state == "down" for m in self._machines.values()):
            return "down"
        return "up"

    def reset(self) -> None:
        """Reset count and state (call on disconnect or exercise change)."""
        for joint in list(self._machines.keys()):
            bounds = joint_range(self.exercise, joint)
            if bounds is not None:
                lo, hi = bounds
                self._machines[joint] = _JointRepMachine(lo, hi)
