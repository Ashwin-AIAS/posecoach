#!/usr/bin/env python3
"""P11 calibration — analyse webcam keypoint-confidence distributions.

Reads one or more JSON captures produced by ``scripts/ws_conf_recorder.js`` (the
browser DevTools recorder) and reports the real per-joint confidence
distribution from an actual session, then recommends an angle-confidence
threshold based on a chosen percentile.

Why per-triplet minima drive the recommendation
------------------------------------------------
``app/analysis/keypoint_utils.compute_angles`` only emits an angle when **all
three** keypoints of a triplet clear the gate (a logical AND). So the quantity
that decides whether angles — and therefore scores and reps — actually compute
live is the **per-frame minimum confidence across each scored triplet**. We pool
those minima and recommend the threshold at their Nth percentile (default 25th),
i.e. a gate that lets through ~75% of real triplet observations.

This script reads NOTHING from ``app/`` except the canonical joint indices, and
writes NO application code. Measurement only.

Usage
-----
    python scripts/analyze_conf_distribution.py gym_session_1.json [more.json ...] \
        --percentile 25 [--out data/eval/conf_distribution_summary.json] [--plot]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

# COCO 17-keypoint order (index → human name).
COCO_KEYPOINT_NAMES: list[str] = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

# Triplets that feed joint angles. Kept in sync with
# app/analysis/keypoint_utils.ANGLE_TRIPLETS — imported when available, with this
# literal as a no-dependency fallback so the script runs standalone.
_FALLBACK_TRIPLETS: dict[str, tuple[int, int, int]] = {
    "left_knee_angle": (11, 13, 15),
    "right_knee_angle": (12, 14, 16),
    "left_hip_angle": (5, 11, 13),
    "right_hip_angle": (6, 12, 14),
    "left_elbow_angle": (5, 7, 9),
    "right_elbow_angle": (6, 8, 10),
    "left_shoulder_angle": (5, 7, 11),  # (hip, shoulder, elbow) — order matches AND-gate
    "right_shoulder_angle": (6, 8, 12),
}


def _load_triplets() -> dict[str, tuple[int, int, int]]:
    try:
        from app.analysis.keypoint_utils import ANGLE_TRIPLETS  # type: ignore[import-not-found, unused-ignore]

        return dict(ANGLE_TRIPLETS)
    except Exception:  # noqa: BLE001 — standalone fallback is the whole point
        return _FALLBACK_TRIPLETS


# Which joint angles each exercise actually scores. Imported from the form scorer
# (single source of truth); the literal is a standalone fallback for the 7 core.
_FALLBACK_EXERCISE_JOINTS: dict[str, list[str]] = {
    "squat": ["left_knee_angle", "right_knee_angle", "left_hip_angle", "right_hip_angle"],
    "deadlift": ["left_hip_angle", "right_hip_angle", "left_knee_angle", "right_knee_angle"],
    "curl": ["left_elbow_angle", "right_elbow_angle"],
    "bench": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "ohp": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
    "lunge": ["left_knee_angle", "right_knee_angle", "left_hip_angle", "right_hip_angle"],
    "plank": ["left_hip_angle", "right_hip_angle", "hip_trunk_angle"],
}

# hip_trunk_angle isn't a 3-point triplet — it's the angle at the hip midpoint
# built from both shoulders, hips and knees, so its gate min spans all six.
_HIP_TRUNK_INDICES: tuple[int, ...] = (5, 6, 11, 12, 13, 14)


def _load_exercise_joints() -> dict[str, list[str]]:
    try:
        from app.analysis.form_scorer import _EXERCISE_JOINTS  # type: ignore[import-not-found, unused-ignore]

        return dict(_EXERCISE_JOINTS)
    except Exception:  # noqa: BLE001 — standalone fallback is the whole point
        return _FALLBACK_EXERCISE_JOINTS


def _joint_min(conf: list[float], joint: str, triplets: dict[str, tuple[int, int, int]]) -> float | None:
    """Min confidence across the keypoints a scored joint angle depends on.

    Returns None for joint names this script doesn't know how to map.
    """
    trip = triplets.get(joint)
    if trip is not None:
        a, b, c = trip
        return min(conf[a], conf[b], conf[c])
    if joint == "hip_trunk_angle":
        return min(conf[i] for i in _HIP_TRUNK_INDICES)
    return None


def _percentile(samples: list[float], pct: float) -> float:
    """Linear-interpolated percentile; ``pct`` in [0, 100]. 0.0 if empty."""
    if not samples:
        return 0.0
    ordered = sorted(samples)
    rank = (len(ordered) - 1) * (pct / 100.0)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def _mean(samples: list[float]) -> float:
    return sum(samples) / len(samples) if samples else 0.0


def _histogram(samples: list[float], width: int = 40, bins: int = 10) -> list[str]:
    """Text histogram over [0, 1] in ``bins`` buckets."""
    counts = [0] * bins
    for v in samples:
        idx = min(int(v * bins), bins - 1)
        counts[idx] += 1
    peak = max(counts) or 1
    lines: list[str] = []
    for i, c in enumerate(counts):
        lo, hi = i / bins, (i + 1) / bins
        bar = "#" * round(width * c / peak)
        lines.append(f"  {lo:.1f}-{hi:.1f} | {bar:<{width}} {c}")
    return lines


def _load_frames(paths: list[Path]) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"!! skipping {p}: {exc}", file=sys.stderr)
            continue
        file_frames = doc.get("frames", []) if isinstance(doc, dict) else doc
        for fr in file_frames:
            conf = fr.get("confidence")
            if isinstance(conf, list) and len(conf) == 17:
                frames.append(fr)
    return frames


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", nargs="+", type=Path, help="JSON file(s) from ws_conf_recorder.js")
    parser.add_argument(
        "--percentile",
        type=float,
        default=25.0,
        help="Percentile of per-triplet minima to set the threshold at (default 25).",
    )
    parser.add_argument("--out", type=Path, default=None, help="Optional JSON summary output path.")
    parser.add_argument("--plot", action="store_true", help="Also draw matplotlib histograms if available.")
    args = parser.parse_args(argv)

    frames = _load_frames(args.captures)
    if not frames:
        print("No person-detected frames (17-length confidence arrays) found.", file=sys.stderr)
        return 1

    triplets = _load_triplets()
    ex_joints = _load_exercise_joints()

    # Per-joint confidence pool (all 17), plus the decision pool: the per-frame
    # minimum confidence of each joint THIS frame's exercise actually scores.
    per_joint: dict[int, list[float]] = defaultdict(list)
    scored_minima: list[float] = []  # one entry per (frame, scored joint)
    scored_minima_by_ex: dict[str, list[float]] = defaultdict(list)
    frames_with_known_ex = 0

    for fr in frames:
        conf: list[float] = [float(c) for c in fr["confidence"]]
        ex = fr.get("exercise") or "unlabelled"
        for i, c in enumerate(conf):
            per_joint[i].append(c)
        joints = ex_joints.get(ex)
        if joints:
            frames_with_known_ex += 1
            for jn in joints:
                m = _joint_min(conf, jn, triplets)
                if m is not None:
                    scored_minima.append(m)
                    scored_minima_by_ex[ex].append(m)

    # Fall back to all triplets if no frame carried a known exercise label.
    if not scored_minima:
        for fr in frames:
            conf = [float(c) for c in fr["confidence"]]
            for _name, (a, b, cc) in triplets.items():
                scored_minima.append(min(conf[a], conf[b], conf[cc]))
        basis_label = "all scored triplets (no exercise labels found)"
    else:
        basis_label = "joints each exercise actually scores"

    print("=" * 72)
    print("P11 confidence-distribution analysis")
    print("=" * 72)
    print(f"Files            : {', '.join(str(p) for p in args.captures)}")
    print(f"Frames (person)  : {len(frames)}  ({frames_with_known_ex} with a known exercise)")
    print(f"Decision samples : {len(scored_minima)}  basis = {basis_label}")
    exercises = sorted({fr.get("exercise") or "unlabelled" for fr in frames})
    print(f"Exercises seen   : {', '.join(exercises)}")
    print()

    print("Per-joint confidence (mean / p5 / p25 / p50 / p75 / min):")
    print(f"  {'joint':<16} {'n':>6} {'mean':>6} {'p5':>6} {'p25':>6} {'p50':>6} {'p75':>6} {'min':>6}")
    for i in range(17):
        s = per_joint[i]
        print(
            f"  {COCO_KEYPOINT_NAMES[i]:<16} {len(s):>6} {_mean(s):>6.2f} "
            f"{_percentile(s, 5):>6.2f} {_percentile(s, 25):>6.2f} {_percentile(s, 50):>6.2f} "
            f"{_percentile(s, 75):>6.2f} {min(s) if s else 0.0:>6.2f}"
        )
    print()

    print("Min confidence across each exercise's SCORED joints (gate-relevant signal):")
    for line in _histogram(scored_minima):
        print(line)
    print()

    recommended = _percentile(scored_minima, args.percentile)
    print("-" * 72)
    print("THRESHOLD RECOMMENDATION")
    print("-" * 72)
    print(
        f"Recommended angle-confidence gate = {recommended:.2f} "
        f"(the {args.percentile:.0f}th percentile of scored-joint minima)"
    )
    print()
    print("At candidate thresholds:")
    print(f"  {'threshold':>10} {'scored joints valid':>21} {'frames scorable':>17}")
    candidates = sorted({0.5, 0.25, round(recommended, 2)})
    denom_frames = frames_with_known_ex or len(frames)
    for thr in candidates:
        joints_valid = sum(1 for m in scored_minima if m >= thr) / len(scored_minima)
        # A frame is "scorable" when every joint its exercise scores clears the gate
        # (otherwise score collapses to the silent 0.0 default).
        scorable = 0
        for fr in frames:
            conf = [float(c) for c in fr["confidence"]]
            joints = ex_joints.get(fr.get("exercise") or "")
            if not joints:
                continue
            mins = [_joint_min(conf, jn, triplets) for jn in joints]
            if mins and all(m is not None and m >= thr for m in mins):
                scorable += 1
        tag = "  <- current" if thr == 0.5 else ("  <- guess" if thr == 0.25 else "  <- recommended")
        print(f"  {thr:>10.2f} {joints_valid * 100:>20.1f}% {scorable / denom_frames * 100:>16.1f}%{tag}")
    print()

    if scored_minima_by_ex:
        print("Recommended threshold per exercise (same percentile):")
        for ex in sorted(scored_minima_by_ex):
            thr_ex = _percentile(scored_minima_by_ex[ex], args.percentile)
            print(f"  {ex:<20} {thr_ex:.2f}  (n={len(scored_minima_by_ex[ex])})")
        print()

    print("Reading this:")
    print("  * If 'frames scorable' at 0.50 is low but high at the recommendation,")
    print("    the conf-gate mismatch is confirmed as the live bug.")
    print("  * Use the recommended value (rounded) as the new compute_angles gate in P12/P13,")
    print("    and quote THIS provenance in the commit -- not a guess.")
    print("  * If person-detected frames are few, reposition the camera and recapture.")

    if args.out is not None:
        summary = {
            "files": [str(p) for p in args.captures],
            "frames": len(frames),
            "frames_with_known_exercise": frames_with_known_ex,
            "percentile": args.percentile,
            "basis": basis_label,
            "recommended_threshold": round(recommended, 4),
            "per_joint_p25": {COCO_KEYPOINT_NAMES[i]: round(_percentile(per_joint[i], 25), 4) for i in range(17)},
            "per_exercise_threshold": {
                ex: round(_percentile(v, args.percentile), 4) for ex, v in scored_minima_by_ex.items()
            },
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"\nSummary written to {args.out}")

    if args.plot:
        try:
            import matplotlib.pyplot as plt  # type: ignore[import-not-found, unused-ignore]

            plt.hist(scored_minima, bins=20, range=(0, 1), color="#3b82f6", edgecolor="white")
            plt.axvline(recommended, color="#ef4444", linestyle="--", label=f"rec={recommended:.2f}")
            plt.axvline(0.5, color="#6b7280", linestyle=":", label="current=0.50")
            plt.xlabel("scored-joint min confidence")
            plt.ylabel("observations")
            plt.title("P11 calibration - gate-relevant confidence")
            plt.legend()
            plt.tight_layout()
            plt.show()
        except ImportError:
            print("(matplotlib not installed - skipping --plot)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
