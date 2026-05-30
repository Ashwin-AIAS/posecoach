"""Thesis metric: 20 identical inputs must produce < 5% score variance."""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis.form_scorer import SUPPORTED_EXERCISES, score_exercise


def _fixed_kp(seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    kp = rng.uniform(0.1, 0.9, (17, 2)).astype(float)
    kp_conf = np.ones(17, dtype=float)
    return kp, kp_conf


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_form_score_variance_below_5pct(exercise: str) -> None:
    """Score must be deterministic: < 5% CV across 20 identical calls (thesis gate)."""
    kp, kp_conf = _fixed_kp()
    scores = [score_exercise(exercise, kp, kp_conf).score for _ in range(20)]

    mean = np.mean(scores)
    std = np.std(scores)
    cv = (std / mean * 100.0) if mean > 0 else 0.0

    assert cv < 5.0, (
        f"{exercise}: score variance {cv:.2f}% exceeds 5% threshold "
        f"(mean={mean:.1f}, std={std:.4f})"
    )


@pytest.mark.parametrize("exercise", sorted(SUPPORTED_EXERCISES))
def test_form_score_is_exactly_deterministic(exercise: str) -> None:
    """Same input must produce exactly the same score (no randomness anywhere)."""
    kp, kp_conf = _fixed_kp(seed=99)
    r1 = score_exercise(exercise, kp, kp_conf)
    r2 = score_exercise(exercise, kp, kp_conf)
    assert r1.score == r2.score
    assert r1.cues == r2.cues
    assert r1.joint_scores == r2.joint_scores
