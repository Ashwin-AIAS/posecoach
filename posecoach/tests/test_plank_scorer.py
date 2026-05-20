"""Plank scorer: alignment-based scoring, no reps, hold tracking at WS level."""
from __future__ import annotations

import numpy as np

from app.analysis.form_scorer import FormResult, score_exercise
from app.analysis.keypoint_utils import LEFT_HIP, LEFT_KNEE, LEFT_SHOULDER, RIGHT_HIP, RIGHT_KNEE, RIGHT_SHOULDER


def _plank_kp(hip_angle_deg: float = 175.0) -> tuple[np.ndarray, np.ndarray]:
    """Build keypoints that approximate a plank with a given hip angle.

    Shoulders at y=0.3, hips at y=0.5, knees at y=0.5 (horizontal body).
    Adjusting hip_angle_deg by tilting the knee position.
    """
    kp = np.zeros((17, 2), dtype=float)
    kp_conf = np.ones(17, dtype=float)

    # Place shoulder, hip, ankle along a horizontal line
    kp[LEFT_SHOULDER] = [0.2, 0.5]
    kp[RIGHT_SHOULDER] = [0.2, 0.5]
    kp[LEFT_HIP] = [0.5, 0.5]
    kp[RIGHT_HIP] = [0.5, 0.5]

    # Knee position determines the hip angle
    # Perfect plank: knee same y as hip (180°)
    # Raised hips (piked): knee below hip → angle < 180
    import math
    offset = math.tan(math.radians(180.0 - hip_angle_deg)) * 0.3
    kp[LEFT_KNEE] = [0.8, 0.5 + offset]
    kp[RIGHT_KNEE] = [0.8, 0.5 + offset]

    return kp, kp_conf


def test_plank_returns_form_result_not_reps() -> None:
    kp, kp_conf = _plank_kp()
    result = score_exercise("plank", kp, kp_conf)
    assert isinstance(result, FormResult)
    assert not hasattr(result, "rep_count"), "plank scorer must not return rep_count"


def test_plank_has_score_attribute() -> None:
    kp, kp_conf = _plank_kp()
    result = score_exercise("plank", kp, kp_conf)
    assert hasattr(result, "score")
    assert 0.0 <= result.score <= 100.0


def test_plank_good_alignment_scores_higher() -> None:
    good_kp, good_conf = _plank_kp(hip_angle_deg=178.0)
    bad_kp, bad_conf = _plank_kp(hip_angle_deg=130.0)
    good_score = score_exercise("plank", good_kp, good_conf).score
    bad_score = score_exercise("plank", bad_kp, bad_conf).score
    assert good_score > bad_score, f"good={good_score}, bad={bad_score}"


def test_plank_cues_mention_hips_when_misaligned() -> None:
    kp, kp_conf = _plank_kp(hip_angle_deg=120.0)  # severely piked
    result = score_exercise("plank", kp, kp_conf)
    assert len(result.cues) > 0
    combined = " ".join(result.cues).lower()
    assert "hip" in combined or "neutral" in combined or "core" in combined


def test_plank_deterministic() -> None:
    kp, kp_conf = _plank_kp()
    r1 = score_exercise("plank", kp, kp_conf)
    r2 = score_exercise("plank", kp, kp_conf)
    assert r1.score == r2.score
