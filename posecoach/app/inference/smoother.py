from __future__ import annotations

from typing import Any

import numpy.typing as npt


class KeypointSmoother:
    """Exponential Moving Average smoother for raw YOLO keypoints.

    One instance per WebSocket connection — call reset() on disconnect.
    alpha=0.6 balances responsiveness vs. jitter reduction.
    """

    def __init__(self, alpha: float = 0.6) -> None:
        self.alpha = alpha
        self._prev: npt.NDArray[Any] | None = None

    def update(self, kp: npt.NDArray[Any]) -> npt.NDArray[Any]:
        """Smooth a (17, 2) keypoint array in-place and return smoothed copy."""
        if self._prev is None:
            self._prev = kp.copy()
            return kp
        smoothed: npt.NDArray[Any] = self.alpha * kp + (1.0 - self.alpha) * self._prev
        self._prev = smoothed
        return smoothed

    def reset(self) -> None:
        self._prev = None
