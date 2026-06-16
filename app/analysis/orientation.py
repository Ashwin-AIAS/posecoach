"""Body-orientation classifier from COCO-17 keypoints (posing mode, P15).

Orientation gates which posing checks apply and whether left/right symmetry is
even meaningful: it is valid only in front/rear views and collapses in profile
(see IMPROVEMENT_PLAN_P15-P18.md §2). The classifier is geometric and
deterministic — same keypoints always yield the same orientation.

For P15 only front and rear are distinguished precisely; ``side`` is a coarse
stub (no left/right disambiguation) hardened in P16.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy.typing as npt

from app.analysis.keypoint_utils import (
    ANGLE_CONF_THRESHOLD,
    LEFT_EYE,
    LEFT_HIP,
    LEFT_SHOULDER,
    NOSE,
    RIGHT_EYE,
    RIGHT_HIP,
    RIGHT_SHOULDER,
)

ORIENT_FRONT = "front"
ORIENT_REAR = "rear"
ORIENT_SIDE = "side"
ORIENT_UNKNOWN = "unknown"

# Below this shoulder-width / torso-height ratio the shoulders have collapsed onto
# one another → the subject is in profile. A square-on torso sits well above it.
SIDE_RATIO_THRESHOLD = 0.35

# Guards a divide-by-near-zero when the torso projects to almost no height.
_MIN_TORSO_HEIGHT = 1e-6


@dataclass(frozen=True)
class OrientationResult:
    """Classified body orientation plus a 0–1 confidence.

    ``confidence`` blends the geometric margin (how clearly non-profile the torso
    is) with facial-keypoint evidence (faces are visible from the front, hidden
    from the rear). Callers gate orientation-dependent logic on it.
    """

    orientation: str
    confidence: float


def _clamp01(value: float) -> float:
    """Clamp a float into the closed unit interval [0, 1]."""
    return max(0.0, min(1.0, value))


def classify_orientation(
    kp: npt.NDArray[Any],
    kp_conf: npt.NDArray[Any],
    conf_threshold: float = ANGLE_CONF_THRESHOLD,
) -> OrientationResult:
    """Classify the subject's body orientation from normalized keypoints.

    Args:
        kp: Shape (17, 2) normalized keypoints (``.xyn`` from YOLO).
        kp_conf: Shape (17,) per-keypoint confidence scores.
        conf_threshold: Skip the classification when the torso anchors
            (both shoulders + both hips) fall below this confidence.

    Returns:
        An :class:`OrientationResult`. ``ORIENT_UNKNOWN`` (confidence 0.0) when
        the torso anchors are not visible enough to reason about.
    """
    anchors = (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
    if any(kp_conf[i] < conf_threshold for i in anchors):
        return OrientationResult(ORIENT_UNKNOWN, 0.0)

    ls, rs = kp[LEFT_SHOULDER], kp[RIGHT_SHOULDER]
    lh, rh = kp[LEFT_HIP], kp[RIGHT_HIP]

    shoulder_mid_y = (float(ls[1]) + float(rs[1])) / 2.0
    hip_mid_y = (float(lh[1]) + float(rh[1])) / 2.0
    torso_height = abs(hip_mid_y - shoulder_mid_y)
    if torso_height < _MIN_TORSO_HEIGHT:
        return OrientationResult(ORIENT_UNKNOWN, 0.0)

    shoulder_dx = abs(float(ls[0]) - float(rs[0]))
    ratio = shoulder_dx / torso_height

    # Profile: shoulders have projected onto roughly the same x. Left/right are
    # not separable here in P15 — return the coarse ``side`` stub.
    if ratio < SIDE_RATIO_THRESHOLD:
        confidence = _clamp01(1.0 - ratio / SIDE_RATIO_THRESHOLD)
        return OrientationResult(ORIENT_SIDE, confidence)

    # Geometric confidence grows as the torso opens up past the profile threshold.
    geo_conf = _clamp01((ratio - SIDE_RATIO_THRESHOLD) / SIDE_RATIO_THRESHOLD)
    # Facial evidence: nose + eyes are visible from the front, hidden from behind.
    face_conf = (
        float(kp_conf[NOSE]) + float(kp_conf[LEFT_EYE]) + float(kp_conf[RIGHT_EYE])
    ) / 3.0

    # In front view the person's left shoulder projects to the viewer's right
    # (larger x); facing away flips that ordering.
    if float(ls[0]) > float(rs[0]):
        confidence = _clamp01(0.5 * geo_conf + 0.5 * _clamp01(face_conf))
        return OrientationResult(ORIENT_FRONT, confidence)
    confidence = _clamp01(0.5 * geo_conf + 0.5 * _clamp01(1.0 - face_conf))
    return OrientationResult(ORIENT_REAR, confidence)
