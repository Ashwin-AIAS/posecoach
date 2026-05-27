"""Thesis evaluation — YOLO26-Pose detection/pose accuracy gate.

Reports OKS pose mAP@0.50 (and mAP@0.50:0.95) for the fine-tuned model. The
thesis gate is **pose mAP@0.50 > 0.70**.

The validation split lives in Google Drive / Colab (gitignored, not on the
local machine), so this script has two idempotent paths:

1. **Live** — if ``ultralytics`` is importable and a dataset YAML is given via
   ``DATASET_YAML`` (or ``--data``), run ``model.val()`` on the fine-tuned
   weights. NMS-free one-to-one head only — ``end2end=False`` is NEVER passed
   (it silently switches to the NMS head and corrupts pose parsing).
2. **Cached** — otherwise consume the Colab-generated ``yolo_results.json``
   (produced during P01 finetuning) and re-emit it in the standard schema,
   tagged ``source="colab_cached"`` for provenance.

Output: ``data/eval/yolo_results.json``. Exit 0 if the gate passes, else 1.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import stat
import sys
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

OUTPUT_PATH = Path("data/eval/yolo_results.json")
DEFAULT_WEIGHTS = Path("models/yolo_posecoach_v1.pt")
IMG_SIZE = 640
MAP50_GATE = 0.70


def _run_live(weights: Path, dataset_yaml: Path) -> dict[str, Any] | None:
    """Validate with ultralytics, or None if the runtime/data is unavailable."""
    try:
        from ultralytics import YOLO
    except ImportError:
        logger.warning("ultralytics_missing", hint="falling back to cached results")
        return None
    if not weights.exists() or not dataset_yaml.exists():
        logger.warning(
            "live_inputs_missing",
            weights_exists=weights.exists(),
            dataset_exists=dataset_yaml.exists(),
        )
        return None

    model = YOLO(str(weights))
    # NMS-free default one-to-one head. Do NOT pass end2end=False.
    metrics = model.val(data=str(dataset_yaml), imgsz=IMG_SIZE, batch=1, verbose=False)
    pose_map50 = float(metrics.pose.map50)
    pose_map = float(metrics.pose.map)
    logger.info("yolo_live_complete", pose_map50=pose_map50, pose_map=pose_map)
    return {
        "source": "live_ultralytics",
        "weights_path": str(weights),
        "dataset_yaml": str(dataset_yaml),
        "pose_map50": round(pose_map50, 4),
        "pose_map": round(pose_map, 4),
    }


def _run_cached() -> dict[str, Any] | None:
    """Load the Colab-generated yolo_results.json (P01 finetuning output)."""
    if not OUTPUT_PATH.exists():
        logger.error("cached_yolo_results_missing", path=str(OUTPUT_PATH))
        return None
    raw = json.loads(OUTPUT_PATH.read_text())
    pose_map50 = raw.get("pose_map50")
    if pose_map50 is None:
        logger.error("cached_yolo_results_invalid", keys=list(raw.keys()))
        return None
    logger.info("yolo_cached_loaded", pose_map50=pose_map50, pose_map=raw.get("pose_map"))
    return {
        "source": "colab_cached",
        "weights_path": raw.get("weights_path"),
        "original_timestamp": raw.get("timestamp"),
        "pose_map50": round(float(pose_map50), 4),
        "pose_map": round(float(raw["pose_map"]), 4) if raw.get("pose_map") else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="YOLO26-Pose accuracy eval")
    parser.add_argument(
        "--data",
        default=os.environ.get("DATASET_YAML", ""),
        help="Path to dataset YAML for a live val run (optional).",
    )
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    args = parser.parse_args()

    measured: dict[str, Any] | None = None
    if args.data:
        measured = _run_live(Path(args.weights), Path(args.data))
    if measured is None:
        measured = _run_cached()
    if measured is None:
        logger.error("yolo_eval_failed", reason="no live run and no cached results")
        return 1

    pose_map50 = measured["pose_map50"]
    passed = pose_map50 > MAP50_GATE

    payload = {
        "metric": "yolo_pose_map50",
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "model": "yolo26n-pose-posecoach-v1",
        "imgsz": IMG_SIZE,
        "hardware": platform.platform(),
        "gate_map50": MAP50_GATE,
        "thesis_gate_passed": passed,
        **measured,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT_PATH.exists():  # Colab-synced file may carry a read-only flag
        OUTPUT_PATH.chmod(stat.S_IWRITE | stat.S_IREAD)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    logger.info(
        "yolo_eval_complete",
        pose_map50=pose_map50,
        passed=passed,
        source=measured["source"],
        output=str(OUTPUT_PATH),
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
