from __future__ import annotations

import math

# Steady-state (signal not moving) cutoff in Hz-equivalent units, where one
# "second" is one frame (dt defaults to 1.0 for the streaming, frame-at-a-time
# caller). Chosen so a still joint is smoothed exactly as hard as the old fixed
# EMA(alpha=0.6) it replaces: solving alpha(min_cutoff, dt=1) = 0.6 for cutoff.
ONE_EURO_MIN_CUTOFF = 0.24
# Speed coefficient: how much the cutoff rises per degree/frame of *sustained*
# estimated velocity (after the d-cutoff low-pass below has smoothed out a
# single-frame spike). Tuned, together with ONE_EURO_D_CUTOFF, so a multi-frame
# fast rep opens the cutoff enough to track the true peak/trough, while a
# single implausible one-frame jump (sensor glitch, not real motion) decays
# before it can do the same.
ONE_EURO_BETA = 0.1
# Cutoff for the low-pass filter applied to the velocity estimate itself. Held
# well below the textbook default (1.0) so the speed estimate only opens the
# position cutoff for velocity *sustained* over several frames — a single
# one-frame spike is heavily damped on its first sample and decays on the next,
# so it never gets the chance to swing the position filter the way genuine
# multi-frame fast motion does.
ONE_EURO_D_CUTOFF = 0.1
# Hard ceiling on the per-frame velocity fed into the cutoff computation, in
# the same units as the input (degrees per dt). No human joint accelerates
# fast enough to need more than this to recognise "fast motion" — anything
# above it is far more likely an instantaneous tracking glitch than genuine
# movement, so the *excess* speed is not allowed to open the cutoff any
# further. The filtered position itself is never clamped, only the speed
# estimate that modulates how hard it gets smoothed.
ONE_EURO_MAX_DX = 12.0


class _LowPassFilter:
    """First-order exponential low-pass with an explicit, settable alpha."""

    def __init__(self) -> None:
        self._y: float | None = None

    def filter(self, x: float, alpha: float) -> float:
        """Apply one step of the filter and return the new smoothed value."""
        if self._y is None:
            self._y = x
        else:
            self._y = alpha * x + (1.0 - alpha) * self._y
        return self._y

    def reset(self) -> None:
        """Clear all state so the next sample seeds the filter from scratch."""
        self._y = None


class OneEuroFilter:
    """Speed-adaptive low-pass filter (Casiez, Roussel & Vogel — CHI 2012).

    Smooths hard when the input is nearly still (rejecting jitter) and eases
    off when it moves fast (cutting lag), by deriving the position filter's
    cutoff frequency from a low-pass-filtered estimate of the input's own
    speed. Deterministic and streaming: each call only sees the current and
    previous sample, never the future.

    Drop-in replacement for :class:`app.analysis.score_smoother.ScoreSmoother`
    inside the rep counter's per-joint state machine — same ``update``/
    ``reset`` shape, with an optional explicit ``dt`` for non-uniform frame
    spacing (defaults to ``1.0``, i.e. one frame, to stay deterministic for the
    existing sequence-only tests).
    """

    def __init__(
        self,
        min_cutoff: float = ONE_EURO_MIN_CUTOFF,
        beta: float = ONE_EURO_BETA,
        d_cutoff: float = ONE_EURO_D_CUTOFF,
        max_dx: float = ONE_EURO_MAX_DX,
    ) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.max_dx = max_dx
        self._x_filter = _LowPassFilter()
        self._dx_filter = _LowPassFilter()
        self._last_value: float | None = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        """Exponential-smoothing alpha for a low-pass with the given cutoff."""
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def update(self, value: float, dt: float = 1.0) -> float:
        """Feed one sample; return the filtered value.

        Args:
            value: The raw input for this frame.
            dt: Elapsed time since the previous sample, in the same units as
                the cutoff frequencies (frames, by default — keep ``1.0`` for
                deterministic, frame-indexed streams).

        Returns:
            The speed-adapted smoothed value.
        """
        if self._last_value is None:
            dx = 0.0
        else:
            dx = (value - self._last_value) / dt
            dx = max(-self.max_dx, min(self.max_dx, dx))
        edx = self._dx_filter.filter(dx, self._alpha(self.d_cutoff, dt))
        cutoff = self.min_cutoff + self.beta * abs(edx)
        result = self._x_filter.filter(value, self._alpha(cutoff, dt))
        self._last_value = value
        return result

    def reset(self) -> None:
        """Reset all internal state (call on disconnect / exercise change)."""
        self._x_filter.reset()
        self._dx_filter.reset()
        self._last_value = None
