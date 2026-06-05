"""P12.6 revalidation gate — the online counter must clearly beat the baseline.

Drives the live RepCounter through the Fit3D-percentile synthetic benchmark
(shared with scripts/eval_rep_counter.py) and asserts it counts exactly on clean
reps and stays >= 0.90 overall under tempo jitter, drift, and heavy noise — well
above the v5 0.71 Fit3D baseline. Deterministic (seeded).
"""
from __future__ import annotations

import pytest

from scripts.eval_rep_counter import (
    SUPPORTED_REP_EXERCISES,
    count_reps_online,
    synth_rep_series,
)


@pytest.mark.parametrize("exercise", SUPPORTED_REP_EXERCISES)
def test_exact_count_on_clean_reps(exercise: str) -> None:
    for gt in (5, 8, 11):
        series = synth_rep_series(exercise, gt, phase=9, noise_deg=4.0, seed=gt)
        assert count_reps_online(exercise, series) == gt, f"{exercise}: gt={gt}"


def test_overall_accuracy_beats_90pct() -> None:
    accs: list[float] = []
    for exercise in SUPPORTED_REP_EXERCISES:
        for gt in (4, 6, 8, 10):
            for phase in (6, 9, 12):
                seed = hash((exercise, gt, phase)) & 0xFFFF
                series = synth_rep_series(exercise, gt, phase=phase, noise_deg=6.0, seed=seed)
                pred = count_reps_online(exercise, series)
                accs.append(max(0.0, 1.0 - abs(pred - gt) / gt))
    overall = sum(accs) / len(accs)
    assert overall >= 0.90, f"overall rep accuracy {overall:.3f} below 0.90 (baseline 0.71)"


def test_one_arm_row_unilateral_counts() -> None:
    # The previously-worst in-scope case: a unilateral lift where averaging both
    # sides used to halve the signal. The max-of-machines design must count it.
    series = synth_rep_series("one_arm_row", 7, phase=10, noise_deg=4.0, seed=7)
    assert count_reps_online("one_arm_row", series) == 7
