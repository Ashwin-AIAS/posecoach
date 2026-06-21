from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from app.analysis.form_scorer import joint_range
from app.analysis.one_euro import OneEuroFilter


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
    # Shrug — shoulder elevation drives, straight arms are context
    "shrug": RepSignal(
        ("left_shoulder_angle", "right_shoulder_angle"),
        ("left_elbow_angle", "right_elbow_angle"),
    ),
    # Raise — shoulder flexion drives
    "front_raise": RepSignal(("left_shoulder_angle", "right_shoulder_angle")),
    # Overhead extension — elbow drives, elevated shoulder is context
    "overhead_triceps": RepSignal(
        ("left_elbow_angle", "right_elbow_angle"),
        ("left_shoulder_angle", "right_shoulder_angle"),
    ),
    # plank: isometric — no rep signal (uses the hold timer instead)
}

# Fraction of the [p5, p95] range used as the hysteresis dead-band on each side.
# A rep requires entering the flexed zone (<= down) then returning to extended
# (>= up); the band stops noise near a single threshold from double-counting.
_HYSTERESIS = 0.30
# A rep's smoothed travel (top - trough) must reach this fraction of the joint's
# range. A genuine threshold-crossing rep already travels >= 0.40 of the range
# (the gap between the two dead-bands), so this sits just below that floor: it
# only rejects fast, EMA-flattened twitches whose smoothed travel collapsed.
_MIN_AMPLITUDE = 0.30
# Cadence guard: two rep completions closer than this many frames are a bounce,
# not two reps (at 15 fps live this is ~0.27s — faster than any real rep).
_MIN_REP_FRAMES = 4
# EMA weight applied to each newly-completed rep's observed (top, trough) when
# recentring the adaptive thresholds (FIX_REP_COUNTER_SIGNAL pillar B). Applied
# directly (no blending) on the first completed rep, which seeds the estimate.
_THRESHOLD_ADAPT_ALPHA = 0.3
# Dropout bridging (FIX_REP_COUNTER_SIGNAL pillar C): a primary joint angle that
# goes missing (confidence-gated out) for at most this many consecutive frames
# has its last smoothed value carried forward, so a brief occlusion mid-rep
# does not lose the trough/peak. ~3 frames at 15 fps live is ~0.2s — short
# enough that holding can never by itself satisfy `_MIN_REP_FRAMES` and let a
# stale hold manufacture cadence for an unrelated flick. Longer gaps freeze
# state exactly as before (no invented motion).
MAX_BRIDGE_FRAMES = 3


class _JointRepMachine:
    """Hysteresis rep state machine for a single joint angle.

    Two thresholds, seeded from the joint's Fit3D ``[p5, p95]`` range with a
    dead-band between them and recentred after each completed rep onto the
    user's own observed range of motion (pillar B), with a dead-band between
    them. The raw angle is smoothed first with a speed-adaptive
    :class:`OneEuroFilter` (pillar A); a rep increments on a full
    extend -> flex -> extend cycle only if it cleared a minimum amplitude and
    the cadence guard. A brief gap in the angle (perception dropout) bridges by
    holding the last smoothed value for up to :data:`MAX_BRIDGE_FRAMES` frames
    (pillar C). Streaming and deterministic.
    """

    def __init__(self, lo: float, hi: float) -> None:
        self._lo = lo
        self._hi = hi
        span = hi - lo
        self._down = lo + _HYSTERESIS * span
        self._up = hi - _HYSTERESIS * span
        self._min_amp = _MIN_AMPLITUDE * span
        self._filter = OneEuroFilter()
        self._count = 0
        self._state = "up"  # assume the lifter starts extended
        self._top: float | None = None  # peak smoothed angle in the up phase
        self._trough = hi  # deepest smoothed angle in the down phase
        self._frames_since_rep = _MIN_REP_FRAMES  # let the first rep count promptly
        self._last_smoothed: float | None = None
        self._dropout_frames = 0
        # Adaptive-threshold state (pillar B) — None until the first rep
        # completes, at which point the fixed-prior fallback above is replaced.
        self._ema_top: float | None = None
        self._ema_trough: float | None = None

    def update(self, angle: float) -> None:
        """Feed one frame's (already side-specific) joint angle."""
        self._dropout_frames = 0
        a = self._filter.update(angle)
        self._last_smoothed = a
        self._advance(a)

    def on_missing(self) -> None:
        """Feed one frame whose angle was confidence-gated out this frame.

        Bridges gaps of at most :data:`MAX_BRIDGE_FRAMES` by holding the last
        smoothed value (without re-filtering it, so the held value never
        perturbs the One-Euro filter's velocity estimate); longer gaps freeze
        state exactly as if the frame had never arrived.
        """
        self._dropout_frames += 1
        if self._dropout_frames <= MAX_BRIDGE_FRAMES and self._last_smoothed is not None:
            self._advance(self._last_smoothed)

    def _advance(self, a: float) -> None:
        """Run one frame of the hysteresis state machine on a smoothed angle."""
        self._frames_since_rep += 1
        if self._top is None:
            self._top = a
        if self._state == "up":
            if a > self._top:
                self._top = a
            if a <= self._down:
                self._state = "down"
                self._trough = a
        else:  # down
            if a < self._trough:
                self._trough = a
            if a >= self._up:
                amplitude = self._top - self._trough
                if amplitude >= self._min_amp and self._frames_since_rep >= _MIN_REP_FRAMES:
                    self._count += 1
                    self._frames_since_rep = 0
                    self._recentre_thresholds(self._top, self._trough)
                self._state = "up"
                self._top = a

    def _recentre_thresholds(self, top: float, trough: float) -> None:
        """Recentre the dead-band onto the user's observed range (pillar B).

        Clamped to the joint's anatomical ``[lo, hi]`` prior so a noisy
        observation can never drift the band off the body — adaptation may
        only narrow the band onto the user's real ROM, never widen past it.
        """
        top = min(self._hi, max(self._lo, top))
        trough = min(self._hi, max(self._lo, trough))
        if self._ema_top is None or self._ema_trough is None:
            self._ema_top, self._ema_trough = top, trough
        else:
            self._ema_top += _THRESHOLD_ADAPT_ALPHA * (top - self._ema_top)
            self._ema_trough += _THRESHOLD_ADAPT_ALPHA * (trough - self._ema_trough)
        span = self._ema_top - self._ema_trough
        if span <= 0:
            return
        new_down = self._ema_trough + _HYSTERESIS * span
        new_up = self._ema_top - _HYSTERESIS * span
        self._down = min(self._hi, max(self._lo, new_down))
        self._up = min(self._hi, max(self._lo, new_up))

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

        Each tracked joint advances its own machine when its angle is present
        this frame; a missing angle bridges through a brief dropout (pillar C,
        :data:`MAX_BRIDGE_FRAMES`) instead of being silently skipped, so a
        short occlusion mid-rep never loses the trough/peak.
        """
        for joint, machine in self._machines.items():
            angle = angles.get(joint)
            if angle is not None:
                machine.update(angle)
            else:
                machine.on_missing()
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
