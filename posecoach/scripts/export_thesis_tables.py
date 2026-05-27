"""Thesis evaluation — aggregate results into publication-ready tables.

Reads every ``data/eval/*_results.json`` produced by the eval scripts and emits,
under ``data/thesis/``:

* ``thesis_summary.csv`` — one row per thesis metric (value vs target vs pass)
* ``table_*.csv``        — per-metric detail tables
* ``latex/*.tex``        — booktabs LaTeX snippets for the thesis document
* ``*.png``              — figures (only if matplotlib is installed; skipped otherwise)

Missing or indeterminate metrics (e.g. chatbot answer accuracy or SUS before
data collection) are rendered as ``pending`` rather than fabricated. This script
never re-runs evaluation — it only formats existing results. Idempotent.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any, cast

import structlog

logger = structlog.get_logger(__name__)

EVAL_DIR = Path("data/eval")
THESIS_DIR = Path("data/thesis")
LATEX_DIR = THESIS_DIR / "latex"


def _load(name: str) -> dict[str, Any] | None:
    path = EVAL_DIR / name
    if not path.exists():
        logger.warning("results_missing", file=name)
        return None
    return cast("dict[str, Any]", json.loads(path.read_text()))


def _pass_str(passed: bool | None) -> str:
    return "pending" if passed is None else ("pass" if passed else "FAIL")


def _fmt(value: Any, suffix: str = "") -> str:
    return "pending" if value is None else f"{value}{suffix}"


def _write_csv(path: Path, header: list[str], rows: list[list[Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    logger.info("csv_written", path=str(path), rows=len(rows))


def _build_summary(results: dict[str, dict[str, Any] | None]) -> list[list[Any]]:
    """Header: metric, value, target, passed."""
    yolo = results["yolo"]
    lat = results["latency"]
    cons = results["consistency"]
    chat = results["chatbot"]
    sus = results["sus"]
    rows: list[list[Any]] = []

    if yolo:
        rows.append(["YOLO pose mAP@0.5", yolo["pose_map50"], "> 0.70", _pass_str(yolo["thesis_gate_passed"])])
    if lat:
        rows.append(["Inference latency p95 (ms)", lat["p95_ms"], "< 100", _pass_str(lat["thesis_gate_passed"])])
    if cons:
        rows.append(["Form score consistency (max CV %)", cons["overall_max_cv_pct"], "< 5", _pass_str(cons["thesis_gate_passed"])])
    if chat:
        rows.append(["Chatbot answer accuracy", _fmt(chat["answer_accuracy"]), ">= 0.80", _pass_str(chat["thesis_gate_passed"])])
        rows.append(["Chatbot retrieval recall (offline TF-IDF)", chat["retrieval_recall"], "reference", "-"])
    if sus:
        rows.append([f"User study SUS (n={sus['n_participants']})", _fmt(sus["mean_sus"]), ">= 70", _pass_str(sus["thesis_gate_passed"])])
    return rows


def _latex_table(caption: str, label: str, header: list[str], rows: list[list[Any]]) -> str:
    cols = "l" + "r" * (len(header) - 1)
    def esc(x: Any) -> str:
        return str(x).replace("%", r"\%").replace("_", r"\_").replace(">=", r"$\geq$").replace("<", r"$<$").replace(">", r"$>$")
    lines = [
        r"\begin{table}[ht]",
        r"\centering",
        rf"\caption{{{caption}}}",
        rf"\label{{{label}}}",
        rf"\begin{{tabular}}{{{cols}}}",
        r"\toprule",
        " & ".join(esc(h) for h in header) + r" \\",
        r"\midrule",
    ]
    lines += [" & ".join(esc(c) for c in row) + r" \\" for row in rows]
    lines += [r"\bottomrule", r"\end{tabular}", r"\end{table}", ""]
    return "\n".join(lines)


def _maybe_figures(results: dict[str, dict[str, Any] | None]) -> list[str]:
    """Render PNG figures if matplotlib is available; return list of files made."""
    try:
        import matplotlib  # type: ignore[import-not-found]

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # type: ignore[import-not-found]
    except ImportError:
        logger.warning("matplotlib_missing", hint="skipping PNG figures")
        return []

    made: list[str] = []
    cons = results["consistency"]
    if cons:
        ex = sorted(cons["per_exercise"])
        cv = [cons["per_exercise"][e]["robustness_cv_pct"] for e in ex]
        fig, ax = plt.subplots(figsize=(7, 4))
        ax.bar(ex, cv, color="#2563eb")
        ax.axhline(5.0, ls="--", color="red", label="5% gate")
        ax.set_ylabel("Robustness CV (%)")
        ax.set_title("Form-score stability under keypoint jitter")
        ax.legend()
        fig.tight_layout()
        out = THESIS_DIR / "fig_form_consistency.png"
        fig.savefig(out, dpi=150)
        plt.close(fig)
        made.append(str(out))

    lat = results["latency"]
    if lat:
        labels = ["p50", "p95", "p99"]
        vals = [lat.get("p50_ms"), lat.get("p95_ms"), lat.get("p99_ms")]
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.bar(labels, vals, color="#16a34a")
        ax.axhline(100.0, ls="--", color="red", label="100ms gate")
        ax.set_ylabel("Latency (ms)")
        ax.set_title("CPU ONNX inference latency")
        ax.legend()
        fig.tight_layout()
        out = THESIS_DIR / "fig_latency.png"
        fig.savefig(out, dpi=150)
        plt.close(fig)
        made.append(str(out))

    logger.info("figures_written", count=len(made))
    return made


def main() -> int:
    results = {
        "yolo": _load("yolo_results.json"),
        "latency": _load("latency_results.json"),
        "consistency": _load("consistency_results.json"),
        "chatbot": _load("chatbot_results.json"),
        "sus": _load("sus_results.json"),
    }

    THESIS_DIR.mkdir(parents=True, exist_ok=True)
    LATEX_DIR.mkdir(parents=True, exist_ok=True)

    # Summary table (CSV + LaTeX).
    summary_header = ["metric", "value", "target", "result"]
    summary_rows = _build_summary(results)
    _write_csv(THESIS_DIR / "thesis_summary.csv", summary_header, summary_rows)
    (LATEX_DIR / "table_summary.tex").write_text(
        _latex_table("PoseCoach thesis evaluation summary", "tab:summary", summary_header, summary_rows)
    )

    # Latency detail.
    if results["latency"]:
        lat = results["latency"]
        rows = [
            ["mean", lat.get("mean_ms")],
            ["p50", lat.get("p50_ms")],
            ["p95", lat.get("p95_ms")],
            ["p99", lat.get("p99_ms")],
        ]
        _write_csv(THESIS_DIR / "table_latency.csv", ["percentile", "latency_ms"], rows)
        (LATEX_DIR / "table_latency.tex").write_text(
            _latex_table("Inference latency (CPU ONNX, batch=1)", "tab:latency", ["Percentile", "Latency (ms)"], rows)
        )

    # Form consistency detail.
    if results["consistency"]:
        cons = results["consistency"]
        rows = [
            [e, r["mean_score"], r["determinism_cv_pct"], r["robustness_cv_pct"]]
            for e, r in sorted(cons["per_exercise"].items())
        ]
        header = ["exercise", "mean_score", "determinism_cv_pct", "robustness_cv_pct"]
        _write_csv(THESIS_DIR / "table_form_consistency.csv", header, rows)
        (LATEX_DIR / "table_form_consistency.tex").write_text(
            _latex_table(
                "Form-score consistency per exercise", "tab:consistency",
                ["Exercise", "Mean score", "Determinism CV (%)", "Robustness CV (%)"], rows,
            )
        )

    # YOLO detail.
    if results["yolo"]:
        y = results["yolo"]
        rows = [["pose mAP@0.5", y["pose_map50"]], ["pose mAP@0.5:0.95", y.get("pose_map")]]
        _write_csv(THESIS_DIR / "table_yolo.csv", ["metric", "value"], rows)

    # Chatbot detail.
    if results["chatbot"]:
        c = results["chatbot"]
        rows = [
            ["n_pairs", c["n_pairs"]],
            ["retrieval_recall", c["retrieval_recall"]],
            ["answer_accuracy", _fmt(c["answer_accuracy"])],
            ["answers_evaluated", c["answers_evaluated"]],
        ]
        _write_csv(THESIS_DIR / "table_chatbot.csv", ["metric", "value"], rows)

    # User study detail.
    if results["sus"]:
        s = results["sus"]
        rows = [[p["participant_id"], p["sus"]] for p in s["per_participant"]]
        rows.append(["MEAN", _fmt(s["mean_sus"])])
        _write_csv(THESIS_DIR / "table_user_study.csv", ["participant_id", "sus"], rows)

    figures = _maybe_figures(results)

    manifest = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "summary_rows": summary_rows,
        "figures": figures,
        "inputs_present": {k: v is not None for k, v in results.items()},
    }
    (THESIS_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    logger.info("export_complete", output_dir=str(THESIS_DIR), figures=len(figures))
    return 0


if __name__ == "__main__":
    sys.exit(main())
