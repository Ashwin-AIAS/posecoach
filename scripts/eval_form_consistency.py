"""Thesis evaluation — form-score consistency gate.

Measures whether ``app.analysis.form_scorer.score_exercise`` is stable. Two
numbers are reported per exercise:

* **determinism_cv** — coefficient of variation across 20 *identical* keypoint
  arrays. Proves the scorer carries no hidden randomness (must be ~0%).
* **robustness_cv** — CV across 20 arrays perturbed with realistic detector
  jitter (Gaussian noise, sigma=0.5% of frame), evaluated at a *boundary* pose
  (each scored joint at its p95 edge) where the scorer is most sensitive. This
  is the worst-case stability figure; mid-range "good form" sits on the flat
  100-plateau and would trivially report 0.

The thesis gate is ``max(determinism_cv, robustness_cv) < 5%`` across all 7
exercises. Test skeletons are built by forward kinematics so each scored joint
lands at a chosen point of its Fit3D ``[p5, p95]`` range.

Output: ``data/eval/consistency_results.json``. Exit 0 if the gate passes, 1 if
it fails. Pure numpy — no model or network required.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import platform
import sys
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import structlog

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.form_scorer import (  # noqa: E402
    SUPPORTED_EXERCISES,
    _EXERCISE_JOINTS,
    _get_range,
    score_exercise,
)
from app.analysis.keypoint_utils import (  # noqa: E402
    LEFT_ANKLE,
    LEFT_EAR,
    LEFT_ELBOW,
    LEFT_EYE,
    LEFT_HIP,
    LEFT_KNEE,
    LEFT_SHOULDER,
    LEFT_WRIST,
    NOSE,
    RIGHT_ANKLE,
    RIGHT_EAR,
    RIGHT_ELBOW,
    RIGHT_EYE,
    RIGHT_HIP,
    RIGHT_KNEE,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
)

logger = structlog.get_logger(__name__)

OUTPUT_PATH = Path("data/eval/consistency_results.json")
N_SAMPLES = 20
JITTER_SIGMA = 0.005  # normalized coords; ~0.5% of frame, ~3px at 640
CV_GATE_PCT = 5.0
SEED = 42

# Default joint angles (degrees) for limbs an exercise does not score — keeps
# the skeleton a plausible human shape without affecting the measured score.
_DEFAULT_ANGLES: dict[str, float] = {
    "left_hip_angle": 160.0,
    "right_hip_angle": 160.0,
    "left_knee_angle": 170.0,
    "right_knee_angle": 170.0,
    "left_shoulder_angle": 25.0,
    "right_shoulder_angle": 25.0,
    "left_elbow_angle": 165.0,
    "right_elbow_angle": 165.0,
}

# Limb segment lengths in normalized image space.
_FEMUR = 0.18
_SHIN = 0.18
_UPPER_ARM = 0.13
_FOREARM = 0.13


def _unit(v: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _rotate(v: npt.NDArray[np.float64], deg: float) -> npt.NDArray[np.float64]:
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return np.array([v[0] * c - v[1] * s, v[0] * s + v[1] * c])


def _build_skeleton(angles: dict[str, float]) -> npt.NDArray[np.float64]:
    """Forward-kinematic (17, 2) skeleton whose joints match ``angles``.

    Because ``compute_angle`` is unsigned (arccos of a dot product), the
    rotation sign is irrelevant — each measured joint angle equals its target.
    """
    kp = np.zeros((17, 2), dtype=np.float64)

    # Torso anchors (vertical trunk, person facing camera).
    kp[LEFT_SHOULDER] = [0.42, 0.30]
    kp[RIGHT_SHOULDER] = [0.58, 0.30]
    kp[LEFT_HIP] = [0.46, 0.55]
    kp[RIGHT_HIP] = [0.54, 0.55]

    legs = (
        (LEFT_SHOULDER, LEFT_HIP, LEFT_KNEE, LEFT_ANKLE, "left", 1.0),
        (RIGHT_SHOULDER, RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE, "right", -1.0),
    )
    for sh_i, hip_i, knee_i, ank_i, side, sign in legs:
        hip_ang = angles[f"{side}_hip_angle"]
        knee_ang = angles[f"{side}_knee_angle"]
        v_hs = _unit(kp[sh_i] - kp[hip_i])  # hip -> shoulder
        kp[knee_i] = kp[hip_i] + _FEMUR * _rotate(v_hs, sign * hip_ang)
        v_kh = _unit(kp[hip_i] - kp[knee_i])  # knee -> hip
        kp[ank_i] = kp[knee_i] + _SHIN * _rotate(v_kh, sign * knee_ang)

    arms = (
        (LEFT_SHOULDER, LEFT_HIP, LEFT_ELBOW, LEFT_WRIST, "left", 1.0),
        (RIGHT_SHOULDER, RIGHT_HIP, RIGHT_ELBOW, RIGHT_WRIST, "right", -1.0),
    )
    for sh_i, hip_i, elb_i, wri_i, side, sign in arms:
        sh_ang = angles[f"{side}_shoulder_angle"]
        elb_ang = angles[f"{side}_elbow_angle"]
        v_sh_hip = _unit(kp[hip_i] - kp[sh_i])  # shoulder -> hip
        kp[elb_i] = kp[sh_i] + _UPPER_ARM * _rotate(v_sh_hip, sign * sh_ang)
        v_es = _unit(kp[sh_i] - kp[elb_i])  # elbow -> shoulder
        kp[wri_i] = kp[elb_i] + _FOREARM * _rotate(v_es, sign * elb_ang)

    # Head keypoints (unused by any triplet, but kept valid).
    kp[NOSE] = [0.50, 0.22]
    kp[LEFT_EYE] = [0.48, 0.20]
    kp[RIGHT_EYE] = [0.52, 0.20]
    kp[LEFT_EAR] = [0.46, 0.21]
    kp[RIGHT_EAR] = [0.54, 0.21]
    return kp


def _target_angles(exercise: str, where: str) -> dict[str, float]:
    """Build target angles for each scored joint, defaults elsewhere.

    Args:
        exercise: One of the 7 supported exercises.
        where: ``"mid"`` → midpoint of [p5, p95] (good form, flat plateau);
            ``"edge"`` → the p95 boundary (scorer most sensitive).
    """
    angles = dict(_DEFAULT_ANGLES)
    for joint in _EXERCISE_JOINTS[exercise]:
        bounds = _get_range(exercise, joint)
        if bounds is None:
            continue
        lo, hi = bounds
        angles[joint] = (lo + hi) / 2.0 if where == "mid" else hi
    return angles


def _cv_pct(scores: list[float]) -> float:
    """Coefficient of variation as a percentage (std / mean * 100)."""
    arr = np.asarray(scores, dtype=np.float64)
    mean = float(arr.mean())
    if mean == 0.0:
        return 0.0
    return float(arr.std(ddof=0) / mean * 100.0)


def _evaluate_exercise(
    exercise: str, rng: np.random.Generator
) -> dict[str, Any]:
    conf = np.ones(17, dtype=np.float64)
    kp_mid = _build_skeleton(_target_angles(exercise, "mid"))
    kp_edge = _build_skeleton(_target_angles(exercise, "edge"))

    identical = [score_exercise(exercise, kp_mid, conf).score for _ in range(N_SAMPLES)]
    jittered = [
        score_exercise(
            exercise,
            kp_edge + rng.normal(0.0, JITTER_SIGMA, size=kp_edge.shape),
            conf,
        ).score
        for _ in range(N_SAMPLES)
    ]

    det_cv = _cv_pct(identical)
    rob_cv = _cv_pct(jittered)
    result = {
        "mean_score": round(float(np.mean(identical)), 2),
        "determinism_cv_pct": round(det_cv, 4),
        "robustness_cv_pct": round(rob_cv, 4),
        "robustness_mean_score": round(float(np.mean(jittered)), 2),
        "max_cv_pct": round(max(det_cv, rob_cv), 4),
    }
    logger.info("consistency_exercise", exercise=exercise, **result)
    return result


def main() -> int:
    rng = np.random.default_rng(SEED)
    per_exercise: dict[str, dict[str, Any]] = {}
    for exercise in sorted(SUPPORTED_EXERCISES):
        per_exercise[exercise] = _evaluate_exercise(exercise, rng)

    overall_max_cv = max(r["max_cv_pct"] for r in per_exercise.values())
    passed = overall_max_cv < CV_GATE_PCT

    payload = {
        "metric": "form_score_consistency",
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "scorer_version": "form_scorer.score_exercise",
        "hardware": platform.platform(),
        "method": (
            f"{N_SAMPLES} identical + {N_SAMPLES} jittered "
            f"(sigma={JITTER_SIGMA}) inputs per exercise; CV = std/mean"
        ),
        "n_samples_per_exercise": N_SAMPLES,
        "jitter_sigma": JITTER_SIGMA,
        "gate_max_cv_pct": CV_GATE_PCT,
        "overall_max_cv_pct": round(overall_max_cv, 4),
        "thesis_gate_passed": passed,
        "per_exercise": per_exercise,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    logger.info(
        "consistency_eval_complete",
        overall_max_cv_pct=round(overall_max_cv, 4),
        passed=passed,
        output=str(OUTPUT_PATH),
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
