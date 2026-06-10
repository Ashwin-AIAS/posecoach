from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from app.analysis.keypoint_utils import ANGLE_CONF_THRESHOLD, compute_angles

_RANGES_PATH = Path(__file__).parent / "angle_ranges.json"
with _RANGES_PATH.open() as _f:
    _FIT3D: dict[str, dict[str, dict[str, float]]] = json.load(_f)

SUPPORTED_EXERCISES = frozenset(
    {
        # Original 7
        "squat",
        "deadlift",
        "curl",
        "bench",
        "ohp",
        "lunge",
        "plank",
        # Expanded set (Fit3D-validated, nc=1 — scoring + UI only, no retraining)
        "pushup",
        "hammer_curl",
        "lateral_raise",
        "barbell_row",
        "db_shoulder_press",
        "diamond_pushup",
        "drag_curl",
        "one_arm_row",
        # P15 expansion (Fit3D-backed)
        "shrug",
        "front_raise",
        "overhead_triceps",
    }
)

# Maps each UI exercise name to its validated Fit3D data key
_EXERCISE_DATA_KEY: dict[str, str | None] = {
    "squat": "squat",
    "deadlift": "deadlift",
    "curl": "dumbbell_biceps_curls",
    "bench": "pushup",
    "ohp": "neutral_overhead_shoulder_press",
    "lunge": "dumbbell_reverse_lunge",
    "plank": None,  # isometric — uses hardcoded alignment ranges below
    "pushup": "pushup",
    "hammer_curl": "dumbbell_hammer_curls",
    "lateral_raise": "side_lateral_raise",
    "barbell_row": "barbell_row",
    "db_shoulder_press": "dumbbell_overhead_shoulder_press",
    "diamond_pushup": "diamond_pushup",
    "drag_curl": "drag_curl",
    "one_arm_row": "one_arm_row",
    # P15 expansion (Fit3D-backed)
    "shrug": "barbell_shrug",
    "front_raise": "dumbbell_scaptions",
    # Caveat: overhead_extension_thruster source clips include a leg-drive
    # (thruster) component, so knees/hips are deliberately NOT scored here.
    "overhead_triceps": "overhead_extension_thruster",
}

# Joints scored per exercise (subset of ANGLE_TRIPLETS + hip_trunk_angle)
_EXERCISE_JOINTS: dict[str, list[str]] = {
    "squat": ["left_knee_angle", "right_knee_angle", "left_hip_angle", "right_hip_angle"],
    "deadlift": ["left_hip_angle", "right_hip_angle", "left_knee_angle", "right_knee_angle"],
    "curl": ["left_elbow_angle", "right_elbow_angle"],
    "bench": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "ohp": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "lunge": ["left_knee_angle", "right_knee_angle", "left_hip_angle", "right_hip_angle"],
    "plank": ["left_hip_angle", "right_hip_angle", "hip_trunk_angle"],
    "pushup": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "hammer_curl": ["left_elbow_angle", "right_elbow_angle"],
    "lateral_raise": ["left_shoulder_angle", "right_shoulder_angle"],
    "barbell_row": ["left_hip_angle", "right_hip_angle", "left_elbow_angle", "right_elbow_angle"],
    "db_shoulder_press": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "diamond_pushup": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "drag_curl": ["left_elbow_angle", "right_elbow_angle"],
    "one_arm_row": ["left_elbow_angle", "right_elbow_angle", "left_hip_angle", "right_hip_angle"],
    # shrug: arms hang straight (elbow ~147-169 = posture), shoulder angle sweeps
    # as the dumbbells/bar ride up (p5 ~37-47 -> p95 ~110-114 = mover)
    "shrug": ["left_shoulder_angle", "right_shoulder_angle", "left_elbow_angle", "right_elbow_angle"],
    # front_raise: shoulder is the mover (p5 ~39-53 -> p95 ~140-143),
    # elbow stays nearly straight (p5 ~135-142 -> p95 ~173 = posture)
    "front_raise": ["left_shoulder_angle", "right_shoulder_angle", "left_elbow_angle", "right_elbow_angle"],
    # overhead_triceps: elbow is the mover (p5 ~34 -> p95 ~167-168 huge ROM),
    # shoulder stays elevated (p25 ~85-96 -> p75 ~131-133 = posture)
    "overhead_triceps": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
}

# Hardcoded biomechanical ranges for plank (neutral spine alignment)
# hip should be ~170-180° (flat line through shoulder-hip-knee)
_PLANK_RANGES: dict[str, dict[str, float]] = {
    "left_hip_angle": {"p5": 155.0, "p95": 180.0},
    "right_hip_angle": {"p5": 155.0, "p95": 180.0},
    "hip_trunk_angle": {"p5": 160.0, "p95": 180.0},
}

# Coaching cues: (exercise, joint, "low"|"high") → cue string (≤8 words)
_CUES: dict[str, dict[str, dict[str, str]]] = {
    "squat": {
        "left_knee_angle": {"low": "Drive knees out wider", "high": "Squat deeper for full range"},
        "right_knee_angle": {"low": "Drive knees out wider", "high": "Squat deeper for full range"},
        "left_hip_angle": {"low": "Keep chest up and tall", "high": "Hinge deeper at your hips"},
        "right_hip_angle": {"low": "Keep chest up and tall", "high": "Hinge deeper at your hips"},
    },
    "deadlift": {
        "left_hip_angle": {"low": "Keep back flat and neutral", "high": "Push hips back further"},
        "right_hip_angle": {"low": "Keep back flat and neutral", "high": "Push hips back further"},
        "left_knee_angle": {"low": "Keep shins vertical", "high": "Bend knees to engage legs"},
        "right_knee_angle": {"low": "Keep shins vertical", "high": "Bend knees to engage legs"},
    },
    "curl": {
        "left_elbow_angle": {"low": "Lower to full arm extension", "high": "Curl higher for peak squeeze"},
        "right_elbow_angle": {"low": "Lower to full arm extension", "high": "Curl higher for peak squeeze"},
    },
    "bench": {
        "left_elbow_angle": {"low": "Lower bar all the way down", "high": "Press to full lockout"},
        "right_elbow_angle": {"low": "Lower bar all the way down", "high": "Press to full lockout"},
        "left_shoulder_angle": {"low": "Tuck elbows closer in", "high": "Flare elbows slightly out"},
        "right_shoulder_angle": {"low": "Tuck elbows closer in", "high": "Flare elbows slightly out"},
    },
    "ohp": {
        "left_elbow_angle": {"low": "Lower bar to collarbone", "high": "Press to full lockout overhead"},
        "right_elbow_angle": {"low": "Lower bar to collarbone", "high": "Press to full lockout overhead"},
        "left_shoulder_angle": {"low": "Keep elbows slightly forward", "high": "Engage shoulders wider"},
        "right_shoulder_angle": {"low": "Keep elbows slightly forward", "high": "Engage shoulders wider"},
    },
    "lunge": {
        "left_knee_angle": {"low": "Keep front knee over toes", "high": "Lunge deeper on front leg"},
        "right_knee_angle": {"low": "Keep front knee over toes", "high": "Lunge deeper on front leg"},
        "left_hip_angle": {"low": "Keep torso tall and upright", "high": "Lower hips closer to floor"},
        "right_hip_angle": {"low": "Keep torso tall and upright", "high": "Lower hips closer to floor"},
    },
    "plank": {
        "left_hip_angle": {"low": "Lower hips to neutral", "high": "Raise hips to neutral"},
        "right_hip_angle": {"low": "Lower hips to neutral", "high": "Raise hips to neutral"},
        "hip_trunk_angle": {"low": "Engage core to flatten back", "high": "Squeeze glutes to lower hips"},
    },
    "pushup": {
        "left_elbow_angle": {"low": "Don't let chest drop too far", "high": "Lower chest closer to floor"},
        "right_elbow_angle": {"low": "Don't let chest drop too far", "high": "Lower chest closer to floor"},
        "left_shoulder_angle": {"low": "Let elbows track slightly outward", "high": "Tuck elbows closer to body"},
        "right_shoulder_angle": {"low": "Let elbows track slightly outward", "high": "Tuck elbows closer to body"},
    },
    "hammer_curl": {
        "left_elbow_angle": {"low": "Lower to full arm extension", "high": "Curl higher for peak squeeze"},
        "right_elbow_angle": {"low": "Lower to full arm extension", "high": "Curl higher for peak squeeze"},
    },
    "lateral_raise": {
        "left_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
        "right_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
    },
    "barbell_row": {
        "left_hip_angle": {"low": "Raise chest, hinge a little less", "high": "Hinge forward more at hips"},
        "right_hip_angle": {"low": "Raise chest, hinge a little less", "high": "Hinge forward more at hips"},
        "left_elbow_angle": {"low": "Lower the bar with control", "high": "Pull elbows back and up"},
        "right_elbow_angle": {"low": "Lower the bar with control", "high": "Pull elbows back and up"},
    },
    "db_shoulder_press": {
        "left_elbow_angle": {"low": "Press up to full lockout", "high": "Lower weights to shoulder level"},
        "right_elbow_angle": {"low": "Press up to full lockout", "high": "Lower weights to shoulder level"},
        "left_shoulder_angle": {"low": "Drive elbows out and up", "high": "Keep elbows slightly in front"},
        "right_shoulder_angle": {"low": "Drive elbows out and up", "high": "Keep elbows slightly in front"},
    },
    "diamond_pushup": {
        "left_elbow_angle": {"low": "Don't let chest drop too far", "high": "Lower chest closer to floor"},
        "right_elbow_angle": {"low": "Don't let chest drop too far", "high": "Lower chest closer to floor"},
        "left_shoulder_angle": {"low": "Relax elbows slightly outward", "high": "Keep elbows tucked close in"},
        "right_shoulder_angle": {"low": "Relax elbows slightly outward", "high": "Keep elbows tucked close in"},
    },
    "drag_curl": {
        "left_elbow_angle": {"low": "Lower with control to extension", "high": "Drag bar up along body"},
        "right_elbow_angle": {"low": "Lower with control to extension", "high": "Drag bar up along body"},
    },
    "one_arm_row": {
        "left_elbow_angle": {"low": "Lower the weight with control", "high": "Pull elbow up toward hip"},
        "right_elbow_angle": {"low": "Lower the weight with control", "high": "Pull elbow up toward hip"},
        "left_hip_angle": {"low": "Keep your back flat and braced", "high": "Hinge forward, support on bench"},
        "right_hip_angle": {"low": "Keep your back flat and braced", "high": "Hinge forward, support on bench"},
    },
    "shrug": {
        "left_shoulder_angle": {"low": "Let arms hang fully down", "high": "Shrug straight up, not forward"},
        "right_shoulder_angle": {"low": "Let arms hang fully down", "high": "Shrug straight up, not forward"},
        "left_elbow_angle": {"low": "Keep arms straight, don't curl", "high": "Relax your arms"},
        "right_elbow_angle": {"low": "Keep arms straight, don't curl", "high": "Relax your arms"},
    },
    "front_raise": {
        "left_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
        "right_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
        "left_elbow_angle": {"low": "Keep arms nearly straight", "high": "Soften your elbows slightly"},
        "right_elbow_angle": {"low": "Keep arms nearly straight", "high": "Soften your elbows slightly"},
    },
    "overhead_triceps": {
        "left_elbow_angle": {"low": "Stretch deeper behind your head", "high": "Extend to full lockout"},
        "right_elbow_angle": {"low": "Stretch deeper behind your head", "high": "Extend to full lockout"},
        "left_shoulder_angle": {"low": "Keep elbows pointing up", "high": "Tuck elbows closer in"},
        "right_shoulder_angle": {"low": "Keep elbows pointing up", "high": "Tuck elbows closer in"},
    },
}


# Scoring outcome of a single frame, kept distinct from the numeric score so a
# genuinely poor lift is never confused with "I can't measure you" (P13). Only
# ``ok`` carries a meaningful ``score``; the others signal why scoring was skipped.
STATUS_OK = "ok"
STATUS_INSUFFICIENT_CONFIDENCE = "insufficient_confidence"
STATUS_UNKNOWN_EXERCISE = "unknown_exercise"
# The observed movement does not match the chosen exercise (P13). The score is
# suppressed (null) so a wrong-exercise rep is never read as good form.
STATUS_MISMATCH = "mismatch"


@dataclass
class FormResult:
    score: float
    cues: list[str] = field(default_factory=list)
    joint_scores: dict[str, float] = field(default_factory=dict)
    # Raw measured angle (degrees) for each scored joint — powers the overlay arcs.
    measured_angles: dict[str, float] = field(default_factory=dict)
    # Why this result looks the way it does. ``score`` is only meaningful when
    # status == STATUS_OK; the other statuses mean no joints could be measured.
    status: str = STATUS_OK


def worst_joint(joint_scores: Mapping[str, float]) -> str | None:
    """Return the key of the lowest-scoring joint, or None if there are none.

    Ties resolve to the first joint encountered (stable for a given dict order),
    keeping the live overlay's spotlight deterministic.
    """
    if not joint_scores:
        return None
    return min(joint_scores, key=lambda k: joint_scores[k])


def _get_range(exercise: str, joint: str) -> tuple[float, float] | None:
    """Return (lo, hi) = (p5, p95) for a joint, or None if data unavailable."""
    if exercise == "plank":
        r = _PLANK_RANGES.get(joint)
        if r is None:
            return None
        return r["p5"], r["p95"]
    data_key = _EXERCISE_DATA_KEY.get(exercise)
    if data_key is None:
        return None
    exercise_data = _FIT3D.get(data_key, {})
    joint_data = exercise_data.get(joint)
    if joint_data is None:
        return None
    return joint_data["p5"], joint_data["p95"]


def joint_range(exercise: str, joint: str) -> tuple[float, float] | None:
    """Public accessor for a joint's (p5, p95) range — used by the rep counter."""
    return _get_range(exercise, joint)


def joint_percentiles(exercise: str, joint: str) -> dict[str, float] | None:
    """Return the full Fit3D percentile dict (p5..p95) for a joint, or None.

    Used by the exercise verifier to reason about the *working* posture band
    (p25/p50/p75), not just the p5/p95 extremes. Plank (hardcoded alignment
    ranges) only carries p5/p95.
    """
    if exercise == "plank":
        r = _PLANK_RANGES.get(joint)
        return dict(r) if r is not None else None
    data_key = _EXERCISE_DATA_KEY.get(exercise)
    if data_key is None:
        return None
    joint_data = _FIT3D.get(data_key, {}).get(joint)
    return dict(joint_data) if joint_data is not None else None


# Posture-critical joints that should stay STABLE through the rep (not sweep a
# range). These are scored against a tight full-credit core band ([p25, p75]) so
# a flared elbow / sagging hip / rounded back measurably drops the score. Every
# other scored joint is a *mover* whose full healthy ROM ([p5, p95]) earns full
# credit, so good depth is never punished. Roles only — magnitudes come from
# angle_ranges.json (the percentiles), never inlined here.
_POSTURE_JOINTS: dict[str, frozenset[str]] = {
    "bench": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
    "ohp": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
    "pushup": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
    "diamond_pushup": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
    "db_shoulder_press": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
    "barbell_row": frozenset({"left_hip_angle", "right_hip_angle"}),
    "one_arm_row": frozenset({"left_hip_angle", "right_hip_angle"}),
    "plank": frozenset({"left_hip_angle", "right_hip_angle", "hip_trunk_angle"}),
    # P15: straight arms on a shrug/raise, elevated shoulders on overhead triceps
    "shrug": frozenset({"left_elbow_angle", "right_elbow_angle"}),
    "front_raise": frozenset({"left_elbow_angle", "right_elbow_angle"}),
    "overhead_triceps": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
}

# Credit a joint earns at the edge of its full ROM (p5/p95) when it is a posture
# joint held out near the extreme — clearly poor, but not zero.
_POSTURE_EDGE_CREDIT = 40.0


def _percentile_anchors(exercise: str, joint: str) -> list[tuple[float, float]] | None:
    """Build the (angle -> credit) anchor points for a joint's graded curve.

    Mover joints get full credit across [p5, p95] and taper to 0 outside.
    Posture joints get full credit only across [p25, p75], taper to
    ``_POSTURE_EDGE_CREDIT`` at p5/p95, then to 0 beyond — so holding a posture
    joint anywhere but its tight band costs points.
    """
    pct = joint_percentiles(exercise, joint)
    if pct is None:
        return None
    p5, p95 = pct["p5"], pct["p95"]
    span = max(p95 - p5, 10.0)
    # Fill quartiles if a source (e.g. plank) only carries p5/p95.
    p25 = pct.get("p25", p5 + 0.25 * span)
    p75 = pct.get("p75", p5 + 0.75 * span)
    posture = joint in _POSTURE_JOINTS.get(exercise, frozenset())
    if posture:
        margin = max(0.5 * (p75 - p25), 8.0)
        return [
            (p5 - margin, 0.0),
            (p5, _POSTURE_EDGE_CREDIT),
            (p25, 100.0),
            (p75, 100.0),
            (p95, _POSTURE_EDGE_CREDIT),
            (p95 + margin, 0.0),
        ]
    margin = max(0.5 * span, 12.0)
    return [(p5 - margin, 0.0), (p5, 100.0), (p95, 100.0), (p95 + margin, 0.0)]


def _piecewise(angle: float, anchors: list[tuple[float, float]]) -> float:
    """Clamped piecewise-linear interpolation of credit over sorted anchors."""
    if angle <= anchors[0][0]:
        return anchors[0][1]
    if angle >= anchors[-1][0]:
        return anchors[-1][1]
    for (x0, c0), (x1, c1) in zip(anchors, anchors[1:], strict=False):
        if x0 <= angle <= x1:
            t = (angle - x0) / (x1 - x0) if x1 > x0 else 0.0
            return c0 + (c1 - c0) * t
    return anchors[-1][1]


def _score_joint(exercise: str, joint: str, angle: float) -> float:
    """Score a single joint angle with a graded, role-aware curve (0–100)."""
    anchors = _percentile_anchors(exercise, joint)
    if anchors is None:
        return 100.0
    return max(0.0, min(100.0, _piecewise(angle, anchors)))


def score_exercise(
    exercise: str,
    kp: npt.NDArray[Any],
    kp_conf: npt.NDArray[Any],
    conf_threshold: float = ANGLE_CONF_THRESHOLD,
) -> FormResult:
    """Score exercise form and return FormResult with cues.

    Args:
        exercise: One of the supported exercises (see SUPPORTED_EXERCISES).
        kp: Shape (17, 2) normalized keypoints from YOLO.
        kp_conf: Shape (17,) keypoint confidence scores.
        conf_threshold: Skip joints below this confidence.

    Returns FormResult with score, cues, and per-joint breakdown.
    """
    if exercise not in SUPPORTED_EXERCISES:
        return FormResult(
            score=0.0,
            cues=[f"Unknown exercise: {exercise}"],
            status=STATUS_UNKNOWN_EXERCISE,
        )

    angles = compute_angles(kp, kp_conf, conf_threshold)
    target_joints = _EXERCISE_JOINTS[exercise]

    joint_scores: dict[str, float] = {}
    measured_angles: dict[str, float] = {}
    cue_candidates: list[tuple[float, str]] = []  # (deficit, cue)

    for joint in target_joints:
        angle = angles.get(joint)
        if angle is None:
            continue
        bounds = _get_range(exercise, joint)
        if bounds is None:
            continue
        lo, hi = bounds
        js = _score_joint(exercise, joint, angle)
        joint_scores[joint] = js
        measured_angles[joint] = round(angle, 1)

        if js < 100.0:
            # Cue direction: below the healthy band is "low", above it is "high".
            direction = "low" if angle < (lo + hi) / 2.0 else "high"
            cue = _CUES.get(exercise, {}).get(joint, {}).get(direction)
            if cue:
                cue_candidates.append((100.0 - js, cue))

    if not joint_scores:
        # No tracked joint cleared the confidence gate — we can see a person but
        # cannot reliably measure the scored joints. Signal this explicitly rather
        # than emitting a fake 0.0 that reads as "terrible form" (P13).
        return FormResult(
            score=0.0,
            cues=["Position yourself in frame"],
            status=STATUS_INSUFFICIENT_CONFIDENCE,
        )

    overall = float(np.mean(list(joint_scores.values())))

    # Return top 2 cues by severity, deduplicated
    seen: set[str] = set()
    cues: list[str] = []
    for _, cue in sorted(cue_candidates, reverse=True):
        if cue not in seen and len(cues) < 2:
            cues.append(cue)
            seen.add(cue)

    return FormResult(
        score=round(overall, 1),
        cues=cues,
        joint_scores=joint_scores,
        measured_angles=measured_angles,
    )
