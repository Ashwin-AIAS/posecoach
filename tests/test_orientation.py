"""Orientation classifier (P15) — front/rear must classify; side is a stub."""

from __future__ import annotations

import numpy as np

from app.analysis.orientation import (
    ORIENT_FRONT,
    ORIENT_REAR,
    ORIENT_SIDE,
    ORIENT_UNKNOWN,
    classify_orientation,
)

# COCO indices used by the synthetic skeletons below.
_NOSE, _LEYE, _REYE = 0, 1, 2
_LSH, _RSH = 5, 6
_LEL, _REL = 7, 8
_LWR, _RWR = 9, 10
_LHIP, _RHIP = 11, 12
_LKNE, _RKNE = 13, 14
_LANK, _RANK = 15, 16


def _front_skeleton() -> tuple[np.ndarray, np.ndarray]:
    """Square-on, facing camera: person's left shoulder at larger x, face visible."""
    kp = np.zeros((17, 2), dtype=float)
    kp[_NOSE] = (0.50, 0.12)
    kp[_LEYE] = (0.53, 0.10)
    kp[_REYE] = (0.47, 0.10)
    kp[_LSH] = (0.62, 0.27)
    kp[_RSH] = (0.38, 0.27)
    kp[_LEL] = (0.72, 0.20)
    kp[_REL] = (0.28, 0.20)
    kp[_LWR] = (0.68, 0.10)
    kp[_RWR] = (0.32, 0.10)
    kp[_LHIP] = (0.57, 0.55)
    kp[_RHIP] = (0.43, 0.55)
    kp[_LKNE] = (0.585, 0.78)
    kp[_RKNE] = (0.415, 0.78)
    kp[_LANK] = (0.60, 0.98)
    kp[_RANK] = (0.40, 0.98)
    return kp, np.ones(17, dtype=float)


def _rear_skeleton() -> tuple[np.ndarray, np.ndarray]:
    """Facing away: shoulder x-order flips and facial keypoints are not visible."""
    kp, conf = _front_skeleton()
    # Mirror the left/right x ordering for a back-facing torso.
    for left, right in ((_LSH, _RSH), (_LEL, _REL), (_LWR, _RWR), (_LHIP, _RHIP), (_LKNE, _RKNE), (_LANK, _RANK)):
        kp[left, 0], kp[right, 0] = kp[right, 0], kp[left, 0]
    # Face is hidden from behind — low confidence on nose + eyes.
    conf[_NOSE] = conf[_LEYE] = conf[_REYE] = 0.05
    return kp, conf


def _side_skeleton() -> tuple[np.ndarray, np.ndarray]:
    """Profile: both shoulders project to nearly the same x (width collapses)."""
    kp, conf = _front_skeleton()
    kp[_LSH] = (0.50, 0.27)
    kp[_RSH] = (0.46, 0.27)
    kp[_LHIP] = (0.50, 0.55)
    kp[_RHIP] = (0.47, 0.55)
    return kp, conf


def test_front_is_classified_front() -> None:
    kp, conf = _front_skeleton()
    result = classify_orientation(kp, conf)
    assert result.orientation == ORIENT_FRONT
    assert result.confidence > 0.5


def test_rear_is_classified_rear() -> None:
    kp, conf = _rear_skeleton()
    result = classify_orientation(kp, conf)
    assert result.orientation == ORIENT_REAR
    assert result.confidence > 0.5


def test_profile_is_classified_side() -> None:
    kp, conf = _side_skeleton()
    result = classify_orientation(kp, conf)
    assert result.orientation == ORIENT_SIDE


def test_low_confidence_torso_is_unknown() -> None:
    kp, _ = _front_skeleton()
    conf = np.zeros(17, dtype=float)
    result = classify_orientation(kp, conf)
    assert result.orientation == ORIENT_UNKNOWN
    assert result.confidence == 0.0


def test_degenerate_torso_height_is_unknown() -> None:
    """Shoulders and hips at the same height collapse the torso → unknown."""
    kp, conf = _front_skeleton()
    kp[_LHIP] = (0.57, 0.27)
    kp[_RHIP] = (0.43, 0.27)
    result = classify_orientation(kp, conf)
    assert result.orientation == ORIENT_UNKNOWN


def test_classification_is_deterministic() -> None:
    kp, conf = _front_skeleton()
    r1 = classify_orientation(kp, conf)
    r2 = classify_orientation(kp, conf)
    assert r1 == r2
