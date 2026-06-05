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

import json
import math
import sys
from pathlib import Path
from statistics import mean

import numpy as np
from scipy.signal import find_peaks

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.form_scorer import joint_range  # noqa: E402
from app.analysis.rep_counter import REP_SIGNAL, RepCounter  # noqa: E402

# Supported rep-based exercises (plank is isometric — no reps).
SUPPORTED_REP_EXERCISES: tuple[str, ...] = tuple(REP_SIGNAL.keys())

# Live-stream assumptions for the offline oracle's spacing guard.
_FPS = 15

# Benchmark sweep: rep counts x cadence (frames/phase) x injected joint noise.
# Phase 5 is a deliberately rushed tempo; noise up to 8 deg matches noisy webcam
# keypoints. Each series also gets per-rep tempo jitter and a slow baseline drift
# so this is a genuine stress test, not a trivially clean sine wave.
_REP_COUNTS: tuple[int, ...] = (4, 6, 8, 10, 12)
_PHASES: tuple[int, ...] = (5, 7, 9, 12)
_NOISE_DEG: tuple[float, ...] = (0.0, 4.0, 8.0)

_OUT = Path(__file__).resolve().parents[1] / "data" / "eval" / "rep_counter_validation.json"


def _ease(a: float, b: float, frames: int) -> list[float]:
    """Cosine-eased ramp from a to b over `frames` points (excludes the start)."""
    return [
        a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * (i / frames))) for i in range(1, frames + 1)
    ]


def _active_sweep(top: float, bottom: float, n_reps: int, phase: int, rng: np.random.Generator) -> list[float]:
    """A working-limb angle track: n_reps cosine sweeps with per-rep tempo jitter."""
    seq = [top]
    for _ in range(n_reps):
        # +/- up to 2 frames of tempo jitter per phase (never below 4 frames).
        down_f = max(4, phase + int(rng.integers(-2, 3)))
        up_f = max(4, phase + int(rng.integers(-2, 3)))
        seq += _ease(top, bottom, down_f)
        seq += _ease(bottom, top, up_f)
    return seq


def synth_rep_series(
    exercise: str,
    n_reps: int,
    *,
    phase: int = 9,
    noise_deg: float = 0.0,
    drift_deg: float = 5.0,
    seed: int = 0,
) -> dict[str, list[float]]:
    """Build a realistic per-joint angle series for `n_reps` reps.

    Each primary joint sweeps its own Fit3D [p5, p95] range with cosine easing,
    per-rep tempo jitter, a slow sinusoidal baseline drift (the lifter creeping
    toward/away from the camera) and optional Gaussian `noise_deg` jitter — all
    seeded for reproducibility. Bilateral lifts move both sides together;
    unilateral lifts (one-arm row) move only the wider-ROM working side while the
    other stays near extension, the same asymmetry the live counter must survive.
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
            seq = _active_sweep(top, bottom, n_reps, phase, rng)
        else:
            # Near-static supporting limb.
            seq = [hi - 0.05 * (hi - lo)] * (1 + n_reps * 2 * phase)
        # Slow baseline drift + per-frame Gaussian noise.
        out: list[float] = []
        for i, v in enumerate(seq):
            drift = drift_deg * math.sin(2.0 * math.pi * i / max(1, len(seq)))
            jitter = float(rng.normal(0.0, noise_deg)) if noise_deg > 0.0 else 0.0
            out.append(v + drift + jitter)
        series[joint] = out
    return series


def count_reps_online(
    exercise: str,
    series: dict[str, list[float]],
    *,
    occlusion: float = 0.0,
    seed: int = 0,
) -> int:
    """Stream a per-joint series through the live RepCounter (online machine).

    `occlusion` is the fraction of frames whose joints drop out (sent as None),
    modelling keypoints falling below the confidence gate — the dominant source
    of real-world miscounts (a logic-correct counter still misses reps it never
    sees).
    """
    counter = RepCounter(exercise)
    rng = np.random.default_rng(seed)
    n_frames = max(len(s) for s in series.values())
    last = 0
    for i in range(n_frames):
        if occlusion > 0.0 and float(rng.random()) < occlusion:
            frame: dict[str, float | None] = {j: None for j in series}
        else:
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


def _accuracy(pred: int, gt: int) -> float:
    """Per-sequence accuracy, matching the Colab Fit3D harness convention."""
    return max(0.0, 1.0 - abs(pred - gt) / gt)


def validate() -> dict[str, object]:
    """Sweep the benchmark; report online-machine accuracy per exercise + overall.

    Deterministic: every noisy series is seeded from its (exercise, gt, phase,
    noise) coordinates, so the numbers are reproducible run-to-run.
    """
    per_ex_online: dict[str, list[float]] = {}
    per_ex_offline: dict[str, list[float]] = {}
    occluded_accs: list[float] = []
    for exercise in SUPPORTED_REP_EXERCISES:
        on_accs: list[float] = []
        off_accs: list[float] = []
        for gt in _REP_COUNTS:
            for phase in _PHASES:
                for k, noise in enumerate(_NOISE_DEG):
                    seed = hash((exercise, gt, phase, k)) & 0xFFFF
                    series = synth_rep_series(
                        exercise, gt, phase=phase, noise_deg=noise, seed=seed
                    )
                    on_accs.append(_accuracy(count_reps_online(exercise, series), gt))
                    off_accs.append(_accuracy(count_reps_offline(exercise, series), gt))
                    # Stress: 25% of frames drop below the confidence gate.
                    occ = count_reps_online(exercise, series, occlusion=0.25, seed=seed)
                    occluded_accs.append(_accuracy(occ, gt))
        per_ex_online[exercise] = on_accs
        per_ex_offline[exercise] = off_accs

    online_means = {ex: round(mean(a), 4) for ex, a in per_ex_online.items()}
    offline_means = {ex: round(mean(a), 4) for ex, a in per_ex_offline.items()}
    all_online = [a for accs in per_ex_online.values() for a in accs]
    overall = round(mean(all_online), 4)
    overall_occluded = round(mean(occluded_accs), 4)

    fit3d_baseline = None
    if _OUT.exists():
        try:
            prev = json.loads(_OUT.read_text())
            fit3d_baseline = prev.get("fit3d_v5_baseline") or prev.get("summary")
        except (json.JSONDecodeError, OSError):
            fit3d_baseline = None

    n_seq = len(_REP_COUNTS) * len(_PHASES) * len(_NOISE_DEG)
    report: dict[str, object] = {
        "summary": {
            "method": "online_hysteresis_per_joint_max (live RepCounter)",
            "benchmark": "fit3d_percentile_synthetic (local; full Fit3D = Colab)",
            "n_sequences": n_seq * len(SUPPORTED_REP_EXERCISES),
            "n_exercises": len(SUPPORTED_REP_EXERCISES),
            "overall_accuracy": overall,
            "overall_accuracy_25pct_occlusion": overall_occluded,
            "baseline_v5_headline": 0.7102,
            "worst_exercise": min(online_means, key=lambda k: online_means[k]),
            "worst_exercise_accuracy": min(online_means.values()),
            "note": (
                "Local validation uses Fit3D-percentile-derived rep curves with "
                "per-rep tempo jitter, baseline drift, and up to 8 deg noise (the "
                "18GB Fit3D angle series are Drive-only). overall_accuracy is the "
                "counting-logic result on well-detected full-ROM reps; the "
                "occlusion figure drops 25% of frames below the confidence gate "
                "to show realistic degradation (the dominant real-world miscount "
                "source is perception dropout, not counting logic). The offline "
                "find_peaks oracle is reported for cross-check only."
            ),
        },
        "online_per_exercise": dict(sorted(online_means.items(), key=lambda kv: kv[1])),
        "offline_oracle_per_exercise": dict(sorted(offline_means.items(), key=lambda kv: kv[1])),
        "fit3d_v5_baseline": fit3d_baseline,
    }
    return report


def _self_check() -> None:
    """Quick sanity pass — oracle and online machine agree on clean curves."""
    print("Offline find_peaks oracle vs online machine (clean curves):")
    for exercise in SUPPORTED_REP_EXERCISES:
        series = synth_rep_series(exercise, 6)
        on = count_reps_online(exercise, series)
        off = count_reps_offline(exercise, series)
        flag = "" if (on == 6 and off == 6) else "  <-- MISMATCH"
        print(f"  {exercise:18s} online={on} offline={off} (gt=6){flag}")


if __name__ == "__main__":
    _self_check()
    report = validate()
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(report, indent=2))
    summary = report["summary"]
    assert isinstance(summary, dict)
    print(f"\nWrote {_OUT}")
    print(f"  overall online accuracy : {summary['overall_accuracy']}")
    print(f"  worst exercise          : {summary['worst_exercise']} "
          f"({summary['worst_exercise_accuracy']})")
    print(f"  v5 Fit3D baseline        : {summary['baseline_v5_headline']}")
