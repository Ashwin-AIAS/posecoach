"""Every supported exercise must return a valid FormResult from score_exercise."""

from __future__ import annotations

import numpy as np
import pytest

from app.analysis.form_scorer import (
    STATUS_INSUFFICIENT_CONFIDENCE,
    STATUS_UNKNOWN_EXERCISE,
    SUPPORTED_EXERCISES,
    FormResult,
    score_exercise,
)


def _perfect_kp() -> tuple[np.ndarray, np.ndarray]:
    """Synthetic keypoints with all confidence = 1.0."""
    kp = np.random.default_rng(42).uniform(0.1, 0.9, (17, 2)).astype(float)
    kp_conf = np.ones(17, dtype=float)
    return kp, kp_conf


def _low_conf_kp() -> tuple[np.ndarray, np.ndarray]:
    """All keypoints below confidence threshold."""
    kp = np.zeros((17, 2), dtype=float)
    kp_conf = np.zeros(17, dtype=float)
    return kp, kp_conf


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_score_exercise_returns_form_result(exercise: str) -> None:
    kp, kp_conf = _perfect_kp()
    result = score_exercise(exercise, kp, kp_conf)
    assert isinstance(result, FormResult)


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_score_in_valid_range(exercise: str) -> None:
    kp, kp_conf = _perfect_kp()
    result = score_exercise(exercise, kp, kp_conf)
    assert 0.0 <= result.score <= 100.0, f"{exercise}: score {result.score} out of [0,100]"


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_cues_are_short(exercise: str) -> None:
    kp, kp_conf = _perfect_kp()
    result = score_exercise(exercise, kp, kp_conf)
    for cue in result.cues:
        words = cue.split()
        assert len(words) <= 8, f"{exercise}: cue too long ({len(words)} words): '{cue}'"


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_low_confidence_keypoints_gives_position_cue(exercise: str) -> None:
    kp, kp_conf = _low_conf_kp()
    result = score_exercise(exercise, kp, kp_conf)
    assert result.status == STATUS_INSUFFICIENT_CONFIDENCE
    assert len(result.cues) > 0


def test_unknown_exercise_returns_zero_score() -> None:
    kp, kp_conf = _perfect_kp()
    result = score_exercise("burpees", kp, kp_conf)
    assert result.status == STATUS_UNKNOWN_EXERCISE
    assert any("Unknown" in c or "unknown" in c for c in result.cues)


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_joint_scores_present_with_good_keypoints(exercise: str) -> None:
    kp, kp_conf = _perfect_kp()
    result = score_exercise(exercise, kp, kp_conf)
    assert len(result.joint_scores) > 0, f"{exercise}: no joint scores returned"


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_deterministic_same_input_same_output(exercise: str) -> None:
    kp, kp_conf = _perfect_kp()
    r1 = score_exercise(exercise, kp, kp_conf)
    r2 = score_exercise(exercise, kp, kp_conf)
    assert r1.score == r2.score
    assert r1.cues == r2.cues
