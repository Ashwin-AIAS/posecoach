"""Bodybuilding posing scorer (P15) — mirrors ``form_scorer.py`` in shape.

Scores how well a held pose matches a standard along three axes:

* **position** — measurable parameter checks (joint angle, relative position,
  stance width) against a template's target ranges;
* **symmetry** — left/right balance of paired parameters (valid only in
  front/rear orientation — see IMPROVEMENT_PLAN_P15-P18.md §2);
* **hold stability** — temporal steadiness of the keypoints over a hold window,
  tracked separately by :class:`HoldTracker` (the per-frame score itself stays
  deterministic: same keypoints in → same score out).

Poses are *content* (``pose_templates.json``), not code — exactly as exercise
angle ranges live in ``angle_ranges.json``. The scorer never claims to judge
muscularity or conditioning, which pose estimation cannot see.
"""

from __future__ import annotations

import json
import math
import os
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt

from app.analysis.keypoint_utils import (
    LEFT_ANKLE,
    LEFT_ELBOW,
    LEFT_HIP,
    LEFT_SHOULDER,
    LEFT_WRIST,
    RIGHT_ANKLE,
    RIGHT_ELBOW,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
    compute_angles,
)
from app.analysis.orientation import (
    ORIENT_FRONT,
    ORIENT_REAR,
    ORIENT_SIDE,
    classify_orientation,
)

# Low-visibility confidence gate for posing (P16). A held pose is deliberate and
# well-framed, so we apply the documented 0.5 project gate (CLAUDE.md) rather
# than the lower webcam-motion threshold used for rep-based exercises — occluded
# joints (especially the far side in profile) are excluded rather than scored as
# garbage. Env-overridable so it can be tuned against real footage.
POSING_CONF_THRESHOLD = float(os.environ.get("POSING_CONF_THRESHOLD", "0.5"))

_TEMPLATES_PATH = Path(__file__).parent / "pose_templates.json"
with _TEMPLATES_PATH.open() as _f:
    _POSE_DATA: dict[str, dict[str, Any]] = json.load(_f)

# Flatten division → pose → template into a single pose-id lookup. Pose ids are
# unique across divisions, so the UI can pick by pose id alone (nc=1 philosophy:
# the pose comes from the UI, never a classifier baked into the model).
_POSE_REGISTRY: dict[str, dict[str, Any]] = {}
for _division, _poses in _POSE_DATA.items():
    for _pose_id, _template in _poses.items():
        _POSE_REGISTRY[_pose_id] = {"division": _division, **_template}

SUPPORTED_POSES = frozenset(_POSE_REGISTRY)

# Orientation in which left/right symmetry is meaningful.
_SYMMETRY_ORIENTATIONS = frozenset({ORIENT_FRONT, ORIENT_REAR})

# Blend of position vs. symmetry in the overall pose score. Position dominates —
# hitting the shape matters more than perfect balance — but symmetry is a real,
# scored part of posing so it carries weight.
WEIGHT_POSITION = 0.7
WEIGHT_SYMMETRY = 0.3

# Below this classifier confidence we don't reject on a wrong orientation — an
# uncertain read shouldn't blank the user's score.
ORIENTATION_MIN_CONFIDENCE = 0.5

# Fraction of a symmetry tolerance that still earns full credit before the
# credit tapers linearly to zero at the tolerance itself.
_SYMMETRY_FULL_FRACTION = 0.25

# Scoring outcome of a single frame, kept distinct from the numeric score (same
# rationale as ``form_scorer``: a genuinely poor pose must never be confused with
# "I can't measure you").
STATUS_OK = "ok"
STATUS_INSUFFICIENT_CONFIDENCE = "insufficient_confidence"
STATUS_UNKNOWN_POSE = "unknown_pose"
STATUS_WRONG_ORIENTATION = "wrong_orientation"

# Per-orientation cue when the subject is clearly facing the wrong way.
_ORIENTATION_CUES: dict[str, str] = {
    ORIENT_FRONT: "Turn to face the camera",
    ORIENT_REAR: "Turn your back to the camera",
    ORIENT_SIDE: "Turn side-on to the camera",
}


@dataclass
class PoseScore:
    """Result of scoring one frame against a pose template."""

    score: float
    position_score: float
    symmetry_score: float
    cues: list[str] = field(default_factory=list)
    check_scores: dict[str, float] = field(default_factory=dict)
    measured_params: dict[str, float] = field(default_factory=dict)
    orientation: str = ""
    orientation_ok: bool = True
    # Whether left/right symmetry was scored. False in profile (P16) — symmetry is
    # meaningless when half the body is occluded, so it is neither scored nor cued.
    symmetry_applicable: bool = True
    status: str = STATUS_OK


def supported_poses() -> list[str]:
    """Sorted list of pose ids the scorer understands (stable UI ordering)."""
    return sorted(SUPPORTED_POSES)


def pose_label(pose: str) -> str | None:
    """Human-readable label for a pose id, or None if the pose is unknown."""
    template = _POSE_REGISTRY.get(pose)
    return None if template is None else str(template["label"])


def _torso_height(kp: npt.NDArray[Any], kp_conf: npt.NDArray[Any], thr: float) -> float | None:
    """Vertical shoulder-to-hip extent, used to normalize positional params.

    Returns None if the torso anchors are not confident or collapse to zero.
    """
    for idx in (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP):
        if kp_conf[idx] < thr:
            return None
    shoulder_mid_y = (float(kp[LEFT_SHOULDER][1]) + float(kp[RIGHT_SHOULDER][1])) / 2.0
    hip_mid_y = (float(kp[LEFT_HIP][1]) + float(kp[RIGHT_HIP][1])) / 2.0
    height = abs(hip_mid_y - shoulder_mid_y)
    return height if height > 1e-6 else None


def _forearm_vertical(kp: npt.NDArray[Any], elbow: int, wrist: int) -> float:
    """Deviation (degrees) of the elbow→wrist segment from vertical.

    0 = perfectly vertical (forearm points straight up/down), 90 = horizontal.
    """
    dx = float(kp[wrist][0]) - float(kp[elbow][0])
    dy = float(kp[wrist][1]) - float(kp[elbow][1])
    return math.degrees(math.atan2(abs(dx), abs(dy)))


def _compute_params(
    kp: npt.NDArray[Any], kp_conf: npt.NDArray[Any], thr: float
) -> dict[str, float]:
    """Derive every measurable posing parameter from one keypoint frame.

    Only parameters whose constituent keypoints clear ``thr`` are included, so a
    template check on a missing parameter is simply skipped (never faked).
    """
    params: dict[str, float] = {}

    # Joint angles (elbow + shoulder + knee flexion) reuse the tested helper.
    angles = compute_angles(kp, kp_conf, thr)
    for name in (
        "left_elbow_angle",
        "right_elbow_angle",
        "left_shoulder_angle",
        "right_shoulder_angle",
        "left_knee_angle",
        "right_knee_angle",
    ):
        value = angles.get(name)
        if value is not None:
            params[name] = float(value)

    # Profile-valid checks (P16 side poses): the bent front leg is the more-flexed
    # knee, and a raised front heel shows as a vertical gap between the ankles.
    knees = [params[k] for k in ("left_knee_angle", "right_knee_angle") if k in params]
    if knees:
        params["front_knee_angle"] = min(knees)

    torso = _torso_height(kp, kp_conf, thr)
    if torso is not None:
        # Elbow height relative to the shoulder line, normalized by torso height.
        # Positive = elbow above the shoulder (image y grows downward).
        if kp_conf[LEFT_SHOULDER] >= thr and kp_conf[LEFT_ELBOW] >= thr:
            params["left_elbow_height"] = (
                float(kp[LEFT_SHOULDER][1]) - float(kp[LEFT_ELBOW][1])
            ) / torso
        if kp_conf[RIGHT_SHOULDER] >= thr and kp_conf[RIGHT_ELBOW] >= thr:
            params["right_elbow_height"] = (
                float(kp[RIGHT_SHOULDER][1]) - float(kp[RIGHT_ELBOW][1])
            ) / torso
        # Heel raise (side poses): vertical gap between the ankles, normalized by
        # torso height. A lifted front heel makes one ankle sit higher than the other.
        if kp_conf[LEFT_ANKLE] >= thr and kp_conf[RIGHT_ANKLE] >= thr:
            params["heel_raise"] = abs(float(kp[LEFT_ANKLE][1]) - float(kp[RIGHT_ANKLE][1])) / torso

    if kp_conf[LEFT_ELBOW] >= thr and kp_conf[LEFT_WRIST] >= thr:
        params["left_forearm_vertical"] = _forearm_vertical(kp, LEFT_ELBOW, LEFT_WRIST)
    if kp_conf[RIGHT_ELBOW] >= thr and kp_conf[RIGHT_WRIST] >= thr:
        params["right_forearm_vertical"] = _forearm_vertical(kp, RIGHT_ELBOW, RIGHT_WRIST)

    # Stance width: ankle separation ÷ shoulder separation.
    shoulder_dx = abs(float(kp[LEFT_SHOULDER][0]) - float(kp[RIGHT_SHOULDER][0]))
    if (
        kp_conf[LEFT_ANKLE] >= thr
        and kp_conf[RIGHT_ANKLE] >= thr
        and kp_conf[LEFT_SHOULDER] >= thr
        and kp_conf[RIGHT_SHOULDER] >= thr
        and shoulder_dx > 1e-6
    ):
        ankle_dx = abs(float(kp[LEFT_ANKLE][0]) - float(kp[RIGHT_ANKLE][0]))
        params["stance_ratio"] = ankle_dx / shoulder_dx

    return params


def _score_in_range(value: float, lo: float, hi: float, margin: float) -> float:
    """Credit (0–100) for a value vs. a target band, tapering over ``margin``."""
    if lo <= value <= hi:
        return 100.0
    deficit = (lo - value) if value < lo else (value - hi)
    if margin <= 0.0 or deficit >= margin:
        return 0.0
    return 100.0 * (1.0 - deficit / margin)


def _symmetry_credit(a: float, b: float, tolerance: float) -> float:
    """Credit (0–100) for how closely two paired params match.

    Full credit within ``_SYMMETRY_FULL_FRACTION`` of the tolerance, then a
    linear taper to zero at the tolerance.
    """
    if tolerance <= 0.0:
        return 100.0
    delta = abs(a - b)
    full = _SYMMETRY_FULL_FRACTION * tolerance
    if delta <= full:
        return 100.0
    if delta >= tolerance:
        return 0.0
    return 100.0 * (1.0 - (delta - full) / (tolerance - full))


def score_pose(
    pose: str,
    kp: npt.NDArray[Any],
    kp_conf: npt.NDArray[Any],
    conf_threshold: float = POSING_CONF_THRESHOLD,
) -> PoseScore:
    """Score one frame against a pose template (deterministic).

    Args:
        pose: A supported pose id (see :data:`SUPPORTED_POSES`).
        kp: Shape (17, 2) normalized keypoints (``.xyn`` from YOLO).
        kp_conf: Shape (17,) per-keypoint confidence scores.
        conf_threshold: Skip parameters whose keypoints fall below this.

    Returns:
        A :class:`PoseScore`. ``score`` is meaningful only when
        ``status == STATUS_OK``; other statuses explain why scoring was skipped.
    """
    template = _POSE_REGISTRY.get(pose)
    if template is None:
        return PoseScore(
            score=0.0,
            position_score=0.0,
            symmetry_score=0.0,
            cues=[f"Unknown pose: {pose}"],
            status=STATUS_UNKNOWN_POSE,
        )

    required_orient = str(template["orientation"])
    # Symmetry is only meaningful in front/rear; in profile it is disabled (P16).
    symmetry_applies = required_orient in _SYMMETRY_ORIENTATIONS
    orient = classify_orientation(kp, kp_conf, conf_threshold)

    # Clear wrong-orientation gate: only reject when the classifier is confident.
    if (
        orient.orientation != required_orient
        and orient.confidence >= ORIENTATION_MIN_CONFIDENCE
    ):
        cue = _ORIENTATION_CUES.get(required_orient, "Adjust your orientation")
        return PoseScore(
            score=0.0,
            position_score=0.0,
            symmetry_score=0.0,
            cues=[cue],
            orientation=orient.orientation,
            orientation_ok=False,
            symmetry_applicable=symmetry_applies,
            status=STATUS_WRONG_ORIENTATION,
        )

    params = _compute_params(kp, kp_conf, conf_threshold)

    check_scores: dict[str, float] = {}
    cue_candidates: list[tuple[float, str]] = []  # (deficit, cue)
    for check in template["checks"]:
        param = str(check["param"])
        if param not in params:
            continue
        value = params[param]
        lo, hi, margin = float(check["lo"]), float(check["hi"]), float(check["margin"])
        credit = _score_in_range(value, lo, hi, margin)
        check_scores[param] = credit
        if credit < 100.0:
            cue = check["cue_low"] if value < lo else check["cue_high"]
            if cue:
                cue_candidates.append((100.0 - credit, str(cue)))

    if not check_scores:
        # A person is visible but no scored parameter cleared the confidence gate.
        return PoseScore(
            score=0.0,
            position_score=0.0,
            symmetry_score=0.0,
            cues=["Position yourself fully in frame"],
            orientation=orient.orientation,
            symmetry_applicable=symmetry_applies,
            status=STATUS_INSUFFICIENT_CONFIDENCE,
        )

    position_score = float(np.mean(list(check_scores.values())))

    # Symmetry — only where left/right is meaningful (front/rear).
    symmetry_credits: list[float] = []
    if symmetry_applies:
        for entry in template.get("symmetry", []):
            param_a, param_b = entry["params"]
            if param_a not in params or param_b not in params:
                continue
            tol = float(entry["tolerance"])
            credit = _symmetry_credit(params[param_a], params[param_b], tol)
            symmetry_credits.append(credit)
            if credit < 100.0 and entry.get("cue"):
                cue_candidates.append((100.0 - credit, str(entry["cue"])))

    symmetry_score = float(np.mean(symmetry_credits)) if symmetry_credits else 100.0

    if symmetry_credits:
        overall = WEIGHT_POSITION * position_score + WEIGHT_SYMMETRY * symmetry_score
    else:
        overall = position_score

    # Top 2 cues by severity, deduplicated (matches form_scorer behaviour).
    seen: set[str] = set()
    cues: list[str] = []
    for _, cue in sorted(cue_candidates, key=lambda c: c[0], reverse=True):
        if cue not in seen and len(cues) < 2:
            cues.append(cue)
            seen.add(cue)

    return PoseScore(
        score=round(overall, 1),
        position_score=round(position_score, 1),
        symmetry_score=round(symmetry_score, 1),
        cues=cues,
        check_scores={k: round(v, 1) for k, v in check_scores.items()},
        measured_params={k: round(v, 3) for k, v in params.items()},
        orientation=orient.orientation,
        orientation_ok=True,
        symmetry_applicable=symmetry_applies,
        status=STATUS_OK,
    )


# How long (s) a pose must be held above the score threshold to count, and how
# much keypoint jitter (normalized units) maps to zero stability.
HOLD_SCORE_THRESHOLD = 50.0
HOLD_STABILITY_TOLERANCE = 0.04
_HOLD_WINDOW = 30  # frames retained for the variance estimate (~2 s at 15 FPS)
_STEADY_MIN_STABILITY = 70.0


@dataclass
class HoldState:
    """Live hold telemetry for one frame."""

    seconds: float
    stability: float  # 0–100, higher = steadier
    steady: bool


class HoldTracker:
    """Tracks pose hold duration and keypoint steadiness over a window.

    One instance per WebSocket connection — call :meth:`reset` on disconnect or
    when the pose/mode changes. Stateful by design (temporal), so it lives
    outside the deterministic :func:`score_pose`.
    """

    def __init__(
        self,
        score_threshold: float = HOLD_SCORE_THRESHOLD,
        stability_tolerance: float = HOLD_STABILITY_TOLERANCE,
        window: int = _HOLD_WINDOW,
        conf_threshold: float = POSING_CONF_THRESHOLD,
    ) -> None:
        self.score_threshold = score_threshold
        self.stability_tolerance = stability_tolerance
        self.conf_threshold = conf_threshold
        self._frames: deque[npt.NDArray[Any]] = deque(maxlen=window)
        self._hold_start: float | None = None

    def update(
        self,
        score: float,
        kp: npt.NDArray[Any],
        kp_conf: npt.NDArray[Any],
        now: float,
    ) -> HoldState:
        """Fold one frame into the hold estimate and return live telemetry.

        Args:
            score: This frame's pose score (drives the hold gate).
            kp: Shape (17, 2) normalized keypoints.
            kp_conf: Shape (17,) per-keypoint confidence.
            now: Monotonic timestamp (seconds) for the frame.
        """
        if score < self.score_threshold:
            self.reset()
            return HoldState(seconds=0.0, stability=0.0, steady=False)

        if self._hold_start is None:
            self._hold_start = now
        seconds = max(0.0, now - self._hold_start)

        # Only the confident keypoints contribute to the steadiness estimate, so a
        # flickering low-confidence joint can't masquerade as jitter.
        mask = (kp_conf >= self.conf_threshold).astype(float).reshape(-1, 1)
        self._frames.append(np.asarray(kp, dtype=float) * mask)
        stability = self._stability(mask)
        return HoldState(
            seconds=round(seconds, 1),
            stability=round(stability, 1),
            steady=stability >= _STEADY_MIN_STABILITY,
        )

    def _stability(self, mask: npt.NDArray[Any]) -> float:
        """Map mean per-keypoint positional jitter over the window to 0–100."""
        if len(self._frames) < 2:
            return 100.0  # not enough history to call it shaky yet
        stack = np.stack(list(self._frames))  # (frames, 17, 2)
        std = np.std(stack, axis=0)  # (17, 2) per-coordinate std
        weighted = std * mask  # ignore masked-out joints
        denom = float(np.sum(mask)) * 2.0  # 2 coords per active joint
        if denom <= 0.0:
            return 100.0
        jitter = float(np.sum(weighted)) / denom
        return max(0.0, min(100.0, 100.0 * (1.0 - jitter / self.stability_tolerance)))

    def reset(self) -> None:
        """Clear the hold window and timer (call on disconnect / pose change)."""
        self._frames.clear()
        self._hold_start = None
