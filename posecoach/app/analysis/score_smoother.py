from __future__ import annotations


class ScoreSmoother:
    """Exponential Moving Average smoother for the scalar form score.

    One instance per WebSocket connection — call reset() on disconnect.
    alpha=0.6 prevents UI flicker while preserving responsiveness.
    """

    def __init__(self, alpha: float = 0.6) -> None:
        self.alpha = alpha
        self._prev: float | None = None

    def update(self, score: float) -> float:
        if self._prev is None:
            self._prev = score
            return score
        smoothed = self.alpha * score + (1.0 - self.alpha) * self._prev
        self._prev = smoothed
        return smoothed

    def reset(self) -> None:
        self._prev = None
