"""Diagnose rep-counter v5 failure modes per exercise (P12.1).

Reads the Fit3D validation produced in Colab
(``data/eval/rep_counter_validation.json``) and breaks the headline 71% mean
down per exercise, separating the exercises PoseCoach actually scores from the
compound / warm-up Fit3D movements that are out of scope. The point is to show
*where* the average is dragged down before rebuilding the live counter.

Run: ``python scripts/diagnose_rep_counter.py``
Writes: ``data/eval/rep_counter_diagnosis.json``
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

# PoseCoach UI exercise -> Fit3D validation key (mirrors form_scorer._EXERCISE_DATA_KEY).
# These are the only movements the app counts reps for; everything else in the
# Fit3D set (warm-ups, burpees, man-maker, ...) is out of scope for the counter.
SUPPORTED_FIT3D_KEYS: dict[str, str] = {
    "squat": "squat",
    "deadlift": "deadlift",
    "curl": "dumbbell_biceps_curls",
    "bench": "pushup",
    "ohp": "neutral_overhead_shoulder_press",
    "lunge": "dumbbell_reverse_lunge",
    "pushup": "pushup",
    "hammer_curl": "dumbbell_hammer_curls",
    "lateral_raise": "side_lateral_raise",
    "barbell_row": "barbell_row",
    "db_shoulder_press": "dumbbell_overhead_shoulder_press",
    "diamond_pushup": "diamond_pushup",
    "drag_curl": "drag_curl",
    "one_arm_row": "one_arm_row",
}

_REPO = Path(__file__).resolve().parent.parent
_VALIDATION = _REPO / "data" / "eval" / "rep_counter_validation.json"
_OUT = _REPO / "data" / "eval" / "rep_counter_diagnosis.json"


def _bias(rows: list[dict[str, float]]) -> dict[str, int]:
    """Count over- vs under-counts to expose the dominant failure direction."""
    over = sum(1 for r in rows if r["pred_reps"] > r["gt_reps"])
    under = sum(1 for r in rows if r["pred_reps"] < r["gt_reps"])
    exact = sum(1 for r in rows if r["pred_reps"] == r["gt_reps"])
    return {"overcount": over, "undercount": under, "exact": exact}


def main() -> None:
    data = json.loads(_VALIDATION.read_text())
    results: list[dict[str, float]] = data["results"]

    per_ex: dict[str, list[dict[str, float]]] = defaultdict(list)
    for r in results:
        per_ex[str(r["exercise"])].append(r)

    fit3d_to_ui = {v: k for k, v in SUPPORTED_FIT3D_KEYS.items()}
    supported_acc: list[float] = []
    out_of_scope_acc: list[float] = []
    per_exercise: dict[str, dict[str, object]] = {}

    for ex, rows in per_ex.items():
        accs = [float(r["accuracy"]) for r in rows]
        in_scope = ex in fit3d_to_ui
        (supported_acc if in_scope else out_of_scope_acc).extend(accs)
        per_exercise[ex] = {
            "ui_name": fit3d_to_ui.get(ex),
            "in_scope": in_scope,
            "mean_accuracy": round(mean(accs), 3),
            "n": len(accs),
            **_bias(rows),
        }

    diagnosis = {
        "source": "v5_autocorr_period_first (Colab, Fit3D joints3d_25, 50 fps)",
        "headline_mean_accuracy": data["summary"]["mean_accuracy"],
        "supported_subset_mean": round(mean(supported_acc), 3) if supported_acc else None,
        "out_of_scope_mean": round(mean(out_of_scope_acc), 3) if out_of_scope_acc else None,
        "failure_modes": [
            "Global mean is averaged over 47 Fit3D movements; ~33 are warm-ups / "
            "compound CrossFit lifts PoseCoach never scores. Compound lifts "
            "(man_maker 0.00, dumbbell_curl_trifecta 0.00, burpees 0.28) crater "
            "the headline number.",
            "v5 picks ONE globally-dominant periodic angle via autocorrelation. "
            "Compound movements oscillate several joints at different periods, so "
            "the single-period assumption fails outright.",
            "Rows (barbell_row 0.56) underperform: an elbow-only signal on a "
            "machine-guided, small-ROM pull gives a weak, noisy autocorrelation.",
            "Whole-series autocorrelation cannot run live (it needs the full clip "
            "and sees the future) -> unusable for streaming counts. The live "
            "counter must be an online hysteresis state machine instead.",
        ],
        "worst_in_scope": sorted(
            (
                {"exercise": ex, "mean_accuracy": v["mean_accuracy"]}
                for ex, v in per_exercise.items()
                if v["in_scope"]
            ),
            key=lambda d: d["mean_accuracy"],  # type: ignore[arg-type,return-value]
        )[:4],
        "per_exercise": dict(
            sorted(per_exercise.items(), key=lambda kv: kv[1]["mean_accuracy"])  # type: ignore[arg-type,return-value]
        ),
    }

    _OUT.write_text(json.dumps(diagnosis, indent=2))
    print(f"Wrote {_OUT}")
    print(f"  headline mean      : {diagnosis['headline_mean_accuracy']}")
    print(f"  supported subset   : {diagnosis['supported_subset_mean']}")
    print(f"  out-of-scope subset: {diagnosis['out_of_scope_mean']}")


if __name__ == "__main__":
    main()
