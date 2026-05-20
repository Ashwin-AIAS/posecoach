from __future__ import annotations

import numpy as np


class KeypointSmoother:
    """Exponential Moving Average smoother for raw YOLO keypoints.

    One instance per WebSocket connection — call reset() on disconnect.
    alpha=0.6 balances responsiveness vs. jitter reduction.
    """

    def __init__(self, alpha: float = 0.6) -> None:
        self.alpha = alpha
        self._prev: np.ndarray | None = None

    def update(self, kp: np.ndarray) -> np.ndarray:
        """Smooth a (17, 2) keypoint array in-place and return smoothed copy."""
        if self._prev is None:
            self._prev = kp.copy()
            return kp
        smoothed = self.alpha * kp + (1.0 - self.alpha) * self._prev
        self._prev = smoothed
        return smoothed

    def reset(self) -> None:
        self._prev = None
