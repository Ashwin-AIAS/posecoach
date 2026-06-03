from __future__ import annotations

from collections.abc import Mapping

from app.analysis.form_scorer import joint_range

# Primary joint(s) whose flexion/extension cycle defines one rep, per exercise.
# Both sides are averaged for stability; isometric holds (plank) have no reps.
_REP_JOINTS: dict[str, list[str]] = {
    "squat": ["left_knee_angle", "right_knee_angle"],
    "deadlift": ["left_hip_angle", "right_hip_angle"],
    "lunge": ["left_knee_angle", "right_knee_angle"],
    "bench": ["left_elbow_angle", "right_elbow_angle"],
    "pushup": ["left_elbow_angle", "right_elbow_angle"],
    "diamond_pushup": ["left_elbow_angle", "right_elbow_angle"],
    "ohp": ["left_elbow_angle", "right_elbow_angle"],
    "db_shoulder_press": ["left_elbow_angle", "right_elbow_angle"],
    "curl": ["left_elbow_angle", "right_elbow_angle"],
    "hammer_curl": ["left_elbow_angle", "right_elbow_angle"],
    "drag_curl": ["left_elbow_angle", "right_elbow_angle"],
    "barbell_row": ["left_elbow_angle", "right_elbow_angle"],
    "one_arm_row": ["left_elbow_angle", "right_elbow_angle"],
    "lateral_raise": ["left_shoulder_angle", "right_shoulder_angle"],
    # plank: isometric — no reps (uses the hold timer instead)
}

# Fraction of the [p5, p95] range used as the hysteresis dead-band on each side.
# A rep requires entering the flexed zone (≤ down) then returning to extended (≥ up).
_HYSTERESIS = 0.30


class RepCounter:
    """Deterministic streaming rep counter for the live inference loop.

    Tracks the average angle of an exercise's primary joint(s) and counts a rep
    on each full flex→extend cycle using two hysteresis thresholds derived from
    the joint's Fit3D ``[p5, p95]`` range. Streaming (one frame at a time) and
    deterministic: the same angle sequence always yields the same count.

    Isometric exercises (plank) have no rep joints and always report zero.
    """

    def __init__(self, exercise: str) -> None:
        self.exercise = exercise
        self._joints = _REP_JOINTS.get(exercise, [])
        self._down_thr, self._up_thr = self._thresholds()
        self._count = 0
        self._state = "up"  # assume the lifter starts in the extended position

    def _thresholds(self) -> tuple[float | None, float | None]:
        """Compute (down, up) angle thresholds from the joints' averaged range."""
        ranges = [r for j in self._joints if (r := joint_range(self.exercise, j)) is not None]
        if not ranges:
            return None, None
        lo = sum(r[0] for r in ranges) / len(ranges)
        hi = sum(r[1] for r in ranges) / len(ranges)
        span = hi - lo
        return lo + _HYSTERESIS * span, hi - _HYSTERESIS * span

    def update(self, angles: Mapping[str, float | None]) -> int:
        """Feed one frame's joint angles; return the running rep count.

        Frames where every tracked joint is occluded (None) hold the current
        state and count, so a brief dropout never miscounts.
        """
        if self._down_thr is None or self._up_thr is None:
            return self._count
        vals = [a for j in self._joints if (a := angles.get(j)) is not None]
        if not vals:
            return self._count
        angle = sum(vals) / len(vals)
        if self._state == "up" and angle <= self._down_thr:
            self._state = "down"
        elif self._state == "down" and angle >= self._up_thr:
            self._state = "up"
            self._count += 1
        return self._count

    @property
    def count(self) -> int:
        """Reps counted so far on this connection."""
        return self._count

    @property
    def down_thr(self) -> float | None:
        """Flexed-zone threshold angle, or None for isometric exercises.

        Read-only — exposed for P11 diagnostics (the rep-counter state audit).
        """
        return self._down_thr

    @property
    def up_thr(self) -> float | None:
        """Extended-zone threshold angle, or None for isometric exercises.

        Read-only — exposed for P11 diagnostics (the rep-counter state audit).
        """
        return self._up_thr

    @property
    def tracked_joints(self) -> list[str]:
        """Primary rep joints for this exercise (empty for isometric holds).

        Read-only — exposed for P11 diagnostics to count how many tracked
        joints carry a valid (non-None) angle on a given frame.
        """
        return list(self._joints)

    @property
    def state(self) -> str:
        """Coarse phase of the rep cycle, for the live overlay.

        Returns ``"hold"`` for isometric exercises (no tracked rep joints, e.g.
        plank), otherwise the internal flex/extend phase: ``"up"`` while extended
        and ``"down"`` while flexed.
        """
        if self._down_thr is None or self._up_thr is None:
            return "hold"
        return self._state

    def reset(self) -> None:
        """Reset count and state (call on disconnect or exercise change)."""
        self._count = 0
        self._state = "up"
