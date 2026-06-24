"""Pose keypoint validation across CONSECUTIVE frames (FIX_POSE_TRACKING_QUALITY Phase 1.4).

Hard gate honoring the ONNX history: the old Ultralytics-ONNX path returned
``keypoints=None`` on the 2nd+ ``predict()`` call. The current direct
``OnnxPoseSession`` is immune, but any future model/decode change must be proven
against a *sequence*, not a single frame. This script pushes several real
mirror-distance frames (the camera-feed region cropped out of the recorded
device-test clip) through the exact production path
(``OnnxPoseSession`` -> ``run_inference``: letterbox decode -> direct-ONNX
predict -> un-letterbox) and asserts the model returns a non-empty, sane
17-keypoint set across consecutive calls — not None, not frozen (output stuck
while the input moves), not collapsed to a point.

Run::

    MODEL_PATH=models/yolo_posecoach_v1.onnx python scripts/validate_consecutive_frames.py

Exit codes: 0 = pass, 1 = fail (a real regression), 2 = skipped (model or clip
unavailable — e.g. CI without the LFS model or the local-only archive clip).
Writes ``data/eval/consecutive_frames_validation.json``.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import structlog

logger = structlog.get_logger(__name__)

# Recorded device-test clip (screen capture of the live app during the mirror
# workflow). Local-only; override with CLIP_PATH. The camera-feed panel is
# cropped out of the wider screen recording.
CLIP_PATH = Path(os.environ.get("CLIP_PATH", "archive/posecoach_claude_rebuild/Recording 2026-05-29 114927.mp4"))
MODEL_PATH = os.environ.get("MODEL_PATH", "models/yolo_posecoach_v1.onnx")
CROP = (12, 96, 1366, 772)  # x1, y1, x2, y2 of the camera-feed panel (verified)
START_FRAME = 372
N_CONSEC = 16
OUTPUT_PATH = Path("data/eval/consecutive_frames_validation.json")

DISPLAY_GATE = 0.5       # frontend display confidence gate
MIN_VALID_KP = 8         # gated keypoints expected per detected frame
MIN_VERTICAL_SPAN = 0.15 # normalized span of gated kpts (not collapsed to a point)
FROZEN_EPS = 1e-4        # min output change that counts as "moved"
INPUT_MOVED = 0.75       # mean abs pixel delta (0-255) that counts as real input motion


def _encode_b64(bgr: np.ndarray) -> str:
    import cv2

    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("jpeg encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _extract() -> list[tuple[str, np.ndarray]]:
    """(jpeg_b64, crop_bgr) for each consecutive frame; crop lets us measure input motion."""
    import cv2

    cap = cv2.VideoCapture(str(CLIP_PATH))
    x1, y1, x2, y2 = CROP
    cap.set(cv2.CAP_PROP_POS_FRAMES, START_FRAME)
    frames: list[tuple[str, np.ndarray]] = []
    for _ in range(N_CONSEC):
        ok, f = cap.read()
        if not ok:
            break
        crop = f[y1:y2, x1:x2].copy()
        frames.append((_encode_b64(crop), crop))
    cap.release()
    return frames


def _write_result(payload: dict[str, Any]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))


async def _run() -> int:
    if not Path(MODEL_PATH).exists():
        logger.warning("model_unavailable", path=MODEL_PATH, hint="skipping (CI without LFS model)")
        return 2
    if not CLIP_PATH.exists():
        logger.warning("clip_unavailable", path=str(CLIP_PATH), hint="local-only archive clip")
        return 2
    try:
        import cv2  # noqa: F401
    except ImportError:
        logger.warning("opencv_missing", hint="pip install opencv-python-headless")
        return 2

    from app.inference.onnx_session import OnnxPoseSession
    from app.inference.runner import run_inference

    frames = _extract()
    if len(frames) < 2:
        logger.error("too_few_frames", got=len(frames))
        return 1

    model = OnnxPoseSession(MODEL_PATH)
    executor = ThreadPoolExecutor(max_workers=2)
    failures: list[str] = []
    rows: list[dict[str, Any]] = []
    prev_xy: np.ndarray | None = None
    prev_crop: np.ndarray | None = None
    stuck: list[int] = []

    for i, (fb, crop) in enumerate(frames):
        idx = START_FRAME + i
        in_delta = (
            float(np.abs(crop.astype(np.int16) - prev_crop.astype(np.int16)).mean())
            if prev_crop is not None else float("nan")
        )
        prev_crop = crop
        out = await run_inference(model, executor, fb)
        if out is None:
            rows.append({"frame": idx, "person": False})
            continue
        xy, conf = out.kp_xyn, out.kp_conf
        if xy.shape[0] != 17:
            failures.append(f"frame {idx}: {xy.shape[0]} keypoints != 17")
        if not (np.isfinite(xy).all() and np.isfinite(conf).all()):
            failures.append(f"frame {idx}: non-finite keypoints/conf")
        gated = conf >= DISPLAY_GATE
        n_valid = int(gated.sum())
        span_y = float(xy[gated, 1].max() - xy[gated, 1].min()) if n_valid else 0.0
        out_delta = float(np.abs(xy - prev_xy).mean()) if prev_xy is not None else float("nan")
        prev_xy = xy.copy()
        if in_delta == in_delta and in_delta > INPUT_MOVED and out_delta < FROZEN_EPS:
            stuck.append(idx)
        rows.append(
            {
                "frame": idx, "person": True, "valid_kp": n_valid,
                "top_conf": round(float(conf.max()), 3), "span_y": round(span_y, 3),
                "out_delta": None if out_delta != out_delta else round(out_delta, 5),
            }
        )
    executor.shutdown()

    detected = [r for r in rows if r["person"]]
    n = len(detected)
    out_deltas = [r["out_delta"] for r in detected if r["out_delta"] is not None]
    if n < 2:
        failures.append(f"only {n} frame(s) detected — cannot test 2nd+ call behavior")
    if n and not detected:
        failures.append("no person detected in any frame")
    if out_deltas and max(out_deltas) < FROZEN_EPS:
        failures.append("FROZEN: keypoints never change across the sequence")
    if stuck:
        failures.append(f"FROZEN: output stuck while input moved at frames {stuck}")
    if sum(1 for r in detected if r["valid_kp"] < MIN_VALID_KP) > n // 2:
        failures.append("too few valid keypoints across the sequence")
    if sum(1 for r in detected if r["span_y"] < MIN_VERTICAL_SPAN) > n // 2:
        failures.append("COLLAPSED: vertical span too small across the sequence")

    passed = not failures
    payload = {
        "metric": "consecutive_frame_keypoints",
        "timestamp": datetime.now(UTC).isoformat(),
        "model": MODEL_PATH,
        "imgsz": model.imgsz,
        "frames": len(frames),
        "detected": n,
        "passed": passed,
        "failures": failures,
        "rows": rows,
    }
    _write_result(payload)
    logger.info(
        "consecutive_validation_complete",
        passed=passed,
        detected=f"{n}/{len(frames)}",
        imgsz=model.imgsz,
        failures=failures,
        output=str(OUTPUT_PATH),
    )
    return 0 if passed else 1


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())
