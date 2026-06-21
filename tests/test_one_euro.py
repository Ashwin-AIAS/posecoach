"""OneEuroFilter — speed-adaptive smoothing used by the rep counter (FIX_REP_COUNTER_SIGNAL)."""

from __future__ import annotations

from app.analysis.one_euro import OneEuroFilter
from app.analysis.score_smoother import ScoreSmoother


def test_converges_to_constant_input() -> None:
    f = OneEuroFilter()
    last = 0.0
    for _ in range(50):
        last = f.update(42.0)
    assert abs(last - 42.0) < 1e-6


def test_lag_on_fast_ramp_is_less_than_old_ema() -> None:
    # A fast linear ramp: the speed-adaptive filter should track closer to the
    # true (unfiltered) value than the fixed EMA(0.6) it replaces, because its
    # cutoff opens up as the estimated velocity grows.
    one_euro = OneEuroFilter()
    ema = ScoreSmoother(0.6)
    ramp = [float(i) for i in range(1, 21)]
    one_euro_err = 0.0
    ema_err = 0.0
    for x in ramp:
        one_euro_err += abs(one_euro.update(x) - x)
        ema_err += abs(ema.update(x) - x)
    assert one_euro_err < ema_err


def test_deterministic_same_input_same_output() -> None:
    seq = [10.0, 15.0, 12.0, 40.0, 38.0, 5.0, 5.0, 5.0]
    f1, f2 = OneEuroFilter(), OneEuroFilter()
    out1 = [f1.update(x) for x in seq]
    out2 = [f2.update(x) for x in seq]
    assert out1 == out2


def test_reset_clears_state() -> None:
    f = OneEuroFilter()
    for x in [10.0, 50.0, 90.0]:
        f.update(x)
    f.reset()

    fresh = OneEuroFilter()
    assert f.update(7.0) == fresh.update(7.0)


def test_explicit_dt_supported() -> None:
    # Public API accepts dt, used by the rep counter's dropout-bridging path
    # (a bridged gap can be fed back with dt > 1.0 to reflect elapsed frames).
    f = OneEuroFilter()
    f.update(10.0)
    result = f.update(20.0, dt=2.0)
    assert isinstance(result, float)
