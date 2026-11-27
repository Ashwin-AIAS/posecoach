from __future__ import annotations

import os
from typing import Any

import numpy as np
import numpy.typing as npt

# COCO 17-keypoint indices
NOSE = 0
LEFT_EYE = 1
RIGHT_EYE = 2
LEFT_EAR = 3
RIGHT_EAR = 4
LEFT_SHOULDER = 5
RIGHT_SHOULDER = 6
LEFT_ELBOW = 7
RIGHT_ELBOW = 8
LEFT_WRIST = 9
RIGHT_WRIST = 10
LEFT_HIP = 11
RIGHT_HIP = 12
LEFT_KNEE = 13
RIGHT_KNEE = 14
LEFT_ANKLE = 15
RIGHT_ANKLE = 16

# Per-keypoint confidence gate for angle computation. A joint angle is only
# computed when all of its constituent keypoints clear this threshold.
#
# Provenance: P11 diagnostics found the live "reps stuck at 0 / scores silently
# broken" bug was a gate mismatch — YOLO predicts at conf=0.10 but this gate was
# 0.50, so real webcam keypoints (routinely 0.10–0.50) were discarded and every
# angle became None. 0.25 is the documented interim value from
# docs/p11_calibration_session.md; replace it via the ANGLE_CONF_THRESHOLD env
# var with the measured percentile once an in-gym capture session is analysed
# (data/eval/conf_distribution_summary.json).
ANGLE_CONF_THRESHOLD = float(os.environ.get("ANGLE_CONF_THRESHOLD", "0.25"))

# (point_A, vertex_B, point_C) — angle is computed at vertex B
ANGLE_TRIPLETS: dict[str, tuple[int, int, int]] = {
    "left_knee_angle": (LEFT_HIP, LEFT_KNEE, LEFT_ANKLE),
    "right_knee_angle": (RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE),
    "left_hip_angle": (LEFT_SHOULDER, LEFT_HIP, LEFT_KNEE),
    "right_hip_angle": (RIGHT_SHOULDER, RIGHT_HIP, RIGHT_KNEE),
    "left_elbow_angle": (LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST),
    "right_elbow_angle": (RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST),
    "left_shoulder_angle": (LEFT_HIP, LEFT_SHOULDER, LEFT_ELBOW),
    "right_shoulder_angle": (RIGHT_HIP, RIGHT_SHOULDER, RIGHT_ELBOW),
}


def compute_angle(a: npt.NDArray[Any], b: npt.NDArray[Any], c: npt.NDArray[Any]) -> float:
    """Angle in degrees at vertex b, formed by rays b→a and b→c.

    Returns 0.0 when vectors are degenerate (near-zero length).
    """
    ba = a - b
    bc = c - b
    norm_ba = np.linalg.norm(ba)
    norm_bc = np.linalg.norm(bc)
    if norm_ba < 1e-6 or norm_bc < 1e-6:
        return 0.0
    cos_angle = np.clip(np.dot(ba, bc) / (norm_ba * norm_bc), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos_angle)))


def compute_angles(
    kp: npt.NDArray[Any],
    kp_conf: npt.NDArray[Any],
    conf_threshold: float = ANGLE_CONF_THRESHOLD,
    aspect: float = 1.0,
) -> dict[str, float | None]:
    """Compute all named joint angles from a (17, 2) keypoint array.

    Returns None for any angle where one or more constituent keypoints
    fall below the confidence threshold.

    Args:
        kp: Shape (17, 2) keypoints normalized to the sent frame (x / width,
            y / height).
        kp_conf: Shape (17,) keypoint confidences.
        conf_threshold: Per-keypoint confidence gate.
        aspect: Frame width / height. Normalized coordinates divide x and y by
            different lengths on a non-square frame, so angles computed on them
            directly are distorted (on a 9:16 portrait phone frame horizontal
            offsets are inflated ~1.8x — a knee angle can read 20-30 degrees
            off). Scaling x by ``aspect`` restores isotropic geometry before the
            angle is measured. ``1.0`` (square / already-isotropic input) is a
            no-op, which keeps stored snapshots and synthetic fixtures unchanged.
    """
    if aspect != 1.0:
        kp = np.array(kp, dtype=float, copy=True)
        kp[:, 0] *= aspect
    angles: dict[str, float | None] = {}
    for name, (idx_a, idx_b, idx_c) in ANGLE_TRIPLETS.items():
        if kp_conf[idx_a] < conf_threshold or kp_conf[idx_b] < conf_threshold or kp_conf[idx_c] < conf_threshold:
            angles[name] = None
            continue
        angles[name] = compute_angle(kp[idx_a], kp[idx_b], kp[idx_c])

    # hip_trunk_angle: angle at hip-midpoint between shoulder-mid and knee-mid
    # Requires both hips + both shoulders + both knees
    hip_conf = min(kp_conf[LEFT_HIP], kp_conf[RIGHT_HIP])
    shoulder_conf = min(kp_conf[LEFT_SHOULDER], kp_conf[RIGHT_SHOULDER])
    knee_conf = min(kp_conf[LEFT_KNEE], kp_conf[RIGHT_KNEE])
    if hip_conf >= conf_threshold and shoulder_conf >= conf_threshold and knee_conf >= conf_threshold:
        hip_mid = (kp[LEFT_HIP] + kp[RIGHT_HIP]) / 2.0
        shoulder_mid = (kp[LEFT_SHOULDER] + kp[RIGHT_SHOULDER]) / 2.0
        knee_mid = (kp[LEFT_KNEE] + kp[RIGHT_KNEE]) / 2.0
        angles["hip_trunk_angle"] = compute_angle(shoulder_mid, hip_mid, knee_mid)
    else:
        angles["hip_trunk_angle"] = None

    return angles


def _confident_mean_y(
    kp: npt.NDArray[Any], kp_conf: npt.NDArray[Any], idx: tuple[int, int], conf_threshold: float
) -> float | None:
    """Mean y of whichever of the two (left/right) keypoints clear the gate."""
    ys = [float(kp[i, 1]) for i in idx if kp_conf[i] >= conf_threshold]
    if not ys:
        return None
    return sum(ys) / len(ys)


def hip_height(
    kp: npt.NDArray[Any],
    kp_conf: npt.NDArray[Any],
    conf_threshold: float = ANGLE_CONF_THRESHOLD,
) -> float | None:
    """Vertical height of the hips above the ankles, in frame-height units.

    A camera-angle-independent squat/lunge signal: the hips drop by the same
    proportion of standing height whether the lifter is filmed from the front,
    the side or a diagonal — unlike the 2D knee angle, which barely changes when
    the knees bend toward the lens. Uses only y coordinates, so it is unaffected
    by frame aspect ratio. Image y grows downward, so height = ankle_y - hip_y.

    Returns None when no hip or no ankle clears the confidence gate, or when the
    geometry is degenerate (hips at or below the ankles — a tracking glitch, or
    the lifter is lying down).
    """
    hip_y = _confident_mean_y(kp, kp_conf, (LEFT_HIP, RIGHT_HIP), conf_threshold)
    ankle_y = _confident_mean_y(kp, kp_conf, (LEFT_ANKLE, RIGHT_ANKLE), conf_threshold)
    if hip_y is None or ankle_y is None:
        return None
    height = ankle_y - hip_y
    return height if height > 0.0 else None
