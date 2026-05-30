"""EMA smoother tests — keypoint and score smoothers."""
from __future__ import annotations

import numpy as np

from app.analysis.score_smoother import ScoreSmoother
from app.inference.smoother import KeypointSmoother


# ── KeypointSmoother ──────────────────────────────────────────────────────────

def test_keypoint_smoother_first_call_returns_input() -> None:
    sm = KeypointSmoother(alpha=0.6)
    kp = np.ones((17, 2), dtype=float)
    result = sm.update(kp)
    np.testing.assert_array_equal(result, kp)


def test_keypoint_smoother_ema_converges() -> None:
    sm = KeypointSmoother(alpha=0.6)
    target = np.ones((17, 2), dtype=float) * 10.0
    val = np.zeros((17, 2), dtype=float)
    sm.update(val)
    for _ in range(50):
        val = sm.update(target)
    # After 50 steps α=0.6 the EMA should be very close to target
    assert np.allclose(val, target, atol=0.01)


def test_keypoint_smoother_reduces_step_magnitude() -> None:
    sm = KeypointSmoother(alpha=0.6)
    kp0 = np.zeros((17, 2), dtype=float)
    kp1 = np.ones((17, 2), dtype=float) * 100.0
    sm.update(kp0)
    smoothed = sm.update(kp1)
    # EMA with alpha=0.6: smoothed = 0.6*100 + 0.4*0 = 60
    assert np.allclose(smoothed, 60.0, atol=1e-6)


def test_keypoint_smoother_reset_clears_state() -> None:
    sm = KeypointSmoother(alpha=0.6)
    kp = np.ones((17, 2), dtype=float) * 5.0
    sm.update(kp)
    sm.reset()
    assert sm._prev is None


def test_keypoint_smoother_after_reset_acts_like_first_call() -> None:
    sm = KeypointSmoother(alpha=0.6)
    kp1 = np.ones((17, 2)) * 10.0
    kp2 = np.zeros((17, 2))
    sm.update(kp1)
    sm.reset()
    result = sm.update(kp2)
    np.testing.assert_array_equal(result, kp2)


def test_keypoint_smoother_does_not_mutate_input() -> None:
    sm = KeypointSmoother(alpha=0.6)
    kp = np.ones((17, 2), dtype=float)
    original = kp.copy()
    sm.update(kp)
    sm.update(kp)
    np.testing.assert_array_equal(kp, original)


# ── ScoreSmoother ─────────────────────────────────────────────────────────────

def test_score_smoother_first_call_returns_input() -> None:
    sm = ScoreSmoother(alpha=0.6)
    assert sm.update(75.0) == 75.0


def test_score_smoother_ema_formula() -> None:
    sm = ScoreSmoother(alpha=0.6)
    sm.update(0.0)   # seed
    result = sm.update(100.0)
    # 0.6*100 + 0.4*0 = 60
    assert abs(result - 60.0) < 1e-9


def test_score_smoother_converges_to_constant_signal() -> None:
    sm = ScoreSmoother(alpha=0.6)
    score = 0.0
    for _ in range(60):
        score = sm.update(80.0)
    assert abs(score - 80.0) < 0.1


def test_score_smoother_reset_clears_state() -> None:
    sm = ScoreSmoother(alpha=0.6)
    sm.update(50.0)
    sm.reset()
    assert sm._prev is None
    # First call after reset should return the raw value unchanged
    assert sm.update(90.0) == 90.0


def test_score_smoother_damps_spike() -> None:
    sm = ScoreSmoother(alpha=0.6)
    sm.update(50.0)
    spiked = sm.update(100.0)
    # Should be 0.6*100 + 0.4*50 = 80 (not 100)
    assert spiked < 100.0
