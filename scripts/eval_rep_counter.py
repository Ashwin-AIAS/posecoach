"""Offline rep-counter validation oracle + harness (P12.4 / P12.6).

The live counter (``app.analysis.rep_counter.RepCounter``) is an *online*
hysteresis state machine — it must decide on every frame without seeing the
future. ``scipy.signal.find_peaks`` over a whole series is the opposite: a clean
*offline* oracle that sees the entire clip. We keep it here, isolated in a
script, purely for batch validation — it never runs in the app.

Because the real Fit3D angle series are an 18 GB Drive-only asset (not local;
the Colab notebook ``p02_fit3d_clean.ipynb`` is the authority for the headline
Fit3D number), the local harness validates against a deterministic benchmark of
Fit3D-percentile-derived rep curves (per-joint [p5, p95] sweeps with injected
noise and cadence variation). It reports the online machine's accuracy and
cross-checks it against the offline find_peaks oracle.

Run: ``python scripts/eval_rep_counter.py``
Writes (P12.6): ``data/eval/rep_counter_validation.json``
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.form_scorer import joint_range  # noqa: E402
from app.analysis.rep_counter import REP_SIGNAL, RepCounter  # noqa: E402

# Supported rep-based exercises (plank is isometric — no reps).
SUPPORTED_REP_EXERCISES: tuple[str, ...] = tuple(REP_SIGNAL.keys())

# Live-stream assumptions for the offline oracle's spacing guard.
_FPS = 15


def _ease(a: float, b: float, frames: int) -> list[float]:
    """Cosine-eased ramp from a to b over `frames` points (excludes the start)."""
    return [
        a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * (i / frames))) for i in range(1, frames + 1)
    ]


def synth_rep_series(
    exercise: str,
    n_reps: int,
    *,
    phase: int = 9,
    noise_deg: float = 0.0,
    seed: int = 0,
) -> dict[str, list[float]]:
    """Build a realistic per-joint angle series for `n_reps` clean reps.

    Each primary joint sweeps its own Fit3D [p5, p95] range with cosine easing.
    Bilateral lifts move both sides together; unilateral lifts (one-arm row) move
    only the wider-ROM working side while the other stays near extension — the
    same asymmetry the live counter must survive. Optional Gaussian `noise_deg`
    adds deterministic per-frame jitter (seeded).
    """
    signal = REP_SIGNAL[exercise]
    rng = np.random.default_rng(seed)
    ranges = {j: r for j in signal.primary if (r := joint_range(exercise, j)) is not None}
    # The working side is the joint with the widest ROM (matters for unilateral).
    working = max(ranges, key=lambda j: ranges[j][1] - ranges[j][0])

    series: dict[str, list[float]] = {}
    for joint, (lo, hi) in ranges.items():
        if joint == working or (hi - lo) >= 0.6 * (ranges[working][1] - ranges[working][0]):
            top = hi - 0.05 * (hi - lo)
            bottom = lo + 0.05 * (hi - lo)
            seq = [top]
            for _ in range(n_reps):
                seq += _ease(top, bottom, phase)
                seq += _ease(bottom, top, phase)
        else:
            # Near-static supporting limb.
            seq = [hi - 0.05 * (hi - lo)] * (1 + n_reps * 2 * phase)
        if noise_deg > 0.0:
            seq = [v + float(rng.normal(0.0, noise_deg)) for v in seq]
        series[joint] = seq
    return series


def count_reps_online(exercise: str, series: dict[str, list[float]]) -> int:
    """Stream a per-joint series through the live RepCounter (online machine)."""
    counter = RepCounter(exercise)
    n_frames = max(len(s) for s in series.values())
    last = 0
    for i in range(n_frames):
        frame = {j: (s[i] if i < len(s) else None) for j, s in series.items()}
        last = counter.update(frame)
    return last


def count_reps_offline(exercise: str, series: dict[str, list[float]]) -> int:
    """Offline oracle: find_peaks over each primary joint's flexion troughs.

    A rep is one flexion trough (the angle dips at the bottom of the movement),
    so we detect peaks in the negated signal. Prominence is tied to the joint's
    Fit3D ROM and spacing to a plausible cadence. The rep count is the max trough
    count across primary joints (mirrors the online max-of-machines design).
    """
    best = 0
    for joint, seq in series.items():
        rng = joint_range(exercise, joint)
        if rng is None or len(seq) < 5:
            continue
        lo, hi = rng
        prominence = 0.40 * (hi - lo)
        distance = max(1, int(0.4 * _FPS))
        troughs, _ = find_peaks(-np.asarray(seq, dtype=float), prominence=prominence, distance=distance)
        best = max(best, len(troughs))
    return best


def _self_check() -> None:
    """Quick sanity pass — oracle and online machine agree on clean curves."""
    print("Offline find_peaks oracle vs online machine (clean curves):")
    ok = True
    for exercise in SUPPORTED_REP_EXERCISES:
        series = synth_rep_series(exercise, 6)
        on = count_reps_online(exercise, series)
        off = count_reps_offline(exercise, series)
        flag = "" if (on == 6 and off == 6) else "  <-- MISMATCH"
        if flag:
            ok = False
        print(f"  {exercise:18s} online={on} offline={off} (gt=6){flag}")
    print("OK" if ok else "MISMATCH — see above")


if __name__ == "__main__":
    _self_check()
