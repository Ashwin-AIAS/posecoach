"""Thesis evaluation — inference latency gate.

Benchmarks single-frame (batch=1) ONNX inference of the production pose model
and reports p50/p95/p99 latency. The thesis gate is **p95 < 100ms** on CPU,
matching the real-time WebSocket deployment.

Two execution paths (idempotent, picks the best available automatically):

1. **Live** — if ``onnxruntime`` is importable and the ONNX model exists, run
   ``RUNS`` warm inferences on a random 640x640 tensor and time each call.
2. **Cached** — otherwise fall back to the Colab-generated
   ``data/eval/latency_benchmark.json`` (the model was benchmarked on Colab
   CPU during P01) and re-emit it in the standard schema, tagged
   ``source="colab_cached"`` for provenance.

Output: ``data/eval/latency_results.json``. Exit 0 if p95 < 100ms, else 1.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import structlog

logger = structlog.get_logger(__name__)

OUTPUT_PATH = Path("data/eval/latency_results.json")
CACHED_SOURCE = Path("data/eval/latency_benchmark.json")
DEFAULT_MODEL = Path("models/yolo_posecoach_v1.onnx")
IMG_SIZE = 640
WARMUP = 10
RUNS = 100
P95_GATE_MS = 100.0


def _percentiles(samples_ms: list[float]) -> dict[str, float]:
    arr = np.asarray(samples_ms, dtype=np.float64)
    return {
        "mean_ms": round(float(arr.mean()), 3),
        "p50_ms": round(float(np.percentile(arr, 50)), 3),
        "p95_ms": round(float(np.percentile(arr, 95)), 3),
        "p99_ms": round(float(np.percentile(arr, 99)), 3),
        "min_ms": round(float(arr.min()), 3),
        "max_ms": round(float(arr.max()), 3),
    }


def _run_live(model_path: Path) -> dict[str, Any] | None:
    """Benchmark the ONNX model with onnxruntime, or None if unavailable."""
    try:
        import onnxruntime as ort  # type: ignore[import-not-found]
    except ImportError:
        logger.warning("onnxruntime_missing", hint="falling back to cached benchmark")
        return None
    if not model_path.exists():
        logger.warning("onnx_model_missing", path=str(model_path))
        return None

    session = ort.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )
    input_meta = session.get_inputs()[0]
    rng = np.random.default_rng(42)
    dummy = rng.random((1, 3, IMG_SIZE, IMG_SIZE), dtype=np.float32)
    feed = {input_meta.name: dummy}

    for _ in range(WARMUP):
        session.run(None, feed)

    samples_ms: list[float] = []
    for _ in range(RUNS):
        start = time.perf_counter()
        session.run(None, feed)
        samples_ms.append((time.perf_counter() - start) * 1000.0)

    stats = _percentiles(samples_ms)
    logger.info("latency_live_complete", runs=RUNS, **stats)
    return {
        "source": "live_onnxruntime",
        "provider": "CPUExecutionProvider",
        "runs": RUNS,
        **stats,
    }


def _run_cached() -> dict[str, Any] | None:
    """Re-emit the Colab-cached benchmark in the standard schema."""
    if not CACHED_SOURCE.exists():
        logger.error("cached_benchmark_missing", path=str(CACHED_SOURCE))
        return None
    raw = json.loads(CACHED_SOURCE.read_text())

    def _round(key: str) -> float | None:
        val = raw.get(key)
        return round(float(val), 3) if val is not None else None

    stats = {
        "mean_ms": _round("mean_ms"),
        "p50_ms": _round("median_ms"),
        "p95_ms": _round("p95_ms"),
        "p99_ms": _round("p99_ms"),
    }
    logger.info("latency_cached_loaded", source=str(CACHED_SOURCE), **stats)
    return {
        "source": "colab_cached",
        "provider": raw.get("provider", "CPUExecutionProvider"),
        "runs": raw.get("runs"),
        **stats,
    }


def main() -> int:
    model_path = Path(os.environ.get("MODEL_PATH", DEFAULT_MODEL))
    measured = _run_live(model_path) or _run_cached()
    if measured is None:
        logger.error("latency_eval_failed", reason="no live runtime and no cached benchmark")
        return 1

    p95 = measured["p95_ms"]
    passed = p95 is not None and p95 < P95_GATE_MS

    payload = {
        "metric": "inference_latency",
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "model": "yolo26n-pose-posecoach-v1",
        "format": "onnx",
        "imgsz": IMG_SIZE,
        "batch_size": 1,
        "hardware": platform.platform(),
        "gate_p95_ms": P95_GATE_MS,
        "thesis_gate_passed": passed,
        **measured,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    logger.info(
        "latency_eval_complete",
        p95_ms=p95,
        passed=passed,
        source=measured["source"],
        output=str(OUTPUT_PATH),
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
