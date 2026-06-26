"""Epley one-rep-max helper — deterministic, unit-tested (P24)."""
from __future__ import annotations

import pytest

from app.workouts.service import one_rep_max


@pytest.mark.parametrize(
    ("weight_kg", "reps", "expected"),
    [
        (100.0, 0, 100.0),  # zero reps → bare weight
        (100.0, 1, 100.0 * (1 + 1 / 30)),
        (100.0, 5, 100.0 * (1 + 5 / 30)),  # 116.667
        (60.0, 10, 60.0 * (1 + 10 / 30)),  # 80.0
        (0.0, 8, 0.0),
    ],
)
def test_one_rep_max_matches_epley(weight_kg: float, reps: int, expected: float) -> None:
    assert one_rep_max(weight_kg, reps) == pytest.approx(expected)


def test_one_rep_max_is_deterministic() -> None:
    assert one_rep_max(102.5, 6) == one_rep_max(102.5, 6)


def test_one_rep_max_increases_with_reps() -> None:
    assert one_rep_max(100.0, 3) < one_rep_max(100.0, 8)
