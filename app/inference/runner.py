from __future__ import annotations

import asyncio
import base64
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import numpy as np
import numpy.typing as npt
import structlog
from PIL import Image

from app.metrics import inference_latency_seconds

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class InferenceOutcome:
    """First-person keypoints plus a P11 timing breakdown for one frame.

    ``latency_ms`` is the end-to-end decode+predict slice (unchanged from the
    prior return value). ``decode_ms`` and ``predict_ms`` split that slice so the
    WS handler can attribute per-stage cost; they are instrumentation only.
    """

    kp_xyn: npt.NDArray[Any]
    kp_conf: npt.NDArray[Any]
    latency_ms: float
    decode_ms: float
    predict_ms: float


_INFERENCE_SIZE = 640
_VRAM_CLEAR_EVERY = 100
_frame_counter = 0


def _decode_frame(frame_b64: str) -> npt.NDArray[np.uint8]:
    """Base64 JPEG → (H, W, 3) uint8 RGB array, resized to 640×640."""
    raw = base64.b64decode(frame_b64)
    img = Image.open(BytesIO(raw)).convert("RGB").resize((_INFERENCE_SIZE, _INFERENCE_SIZE), Image.Resampling.BILINEAR)
    return np.array(img, dtype=np.uint8)


def _predict(model: object, frame: npt.NDArray[np.uint8]) -> object:
    """Synchronous YOLO predict — runs in thread executor, never on async loop."""
    global _frame_counter
    _frame_counter += 1

    # conf=0.10: fine-tuned model was trained on Vicon/Fit3D (studio); webcam input
    # has a different distribution so default 0.25 threshold filters everything out.
    # imgsz=320: cuts inference time ~4x on CPU-starved Render free tier.
    # Note: ONNX Runtime requires matching static shape of 640x640 if exported that way.
    is_onnx = isinstance(getattr(model, "path", ""), str) and getattr(model, "path", "").endswith(".onnx")
    imgsz = 640 if is_onnx else 320

    results = model.predict(frame, verbose=False, conf=0.10, imgsz=imgsz)  # type: ignore[attr-defined]

    # Periodically clear GPU VRAM to prevent OOM
    if _frame_counter % _VRAM_CLEAR_EVERY == 0:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    return results


async def run_inference(
    model: object,
    executor: ThreadPoolExecutor,
    frame_b64: str,
) -> InferenceOutcome | None:
    """Decode frame and run YOLO26 inference asynchronously.

    Returns an :class:`InferenceOutcome` for the first detected person, or None
    if no person is detected.

    kp_xyn: shape (17, 2) normalized [0,1] coordinates
    kp_conf: shape (17,) confidence per keypoint
    """
    loop = asyncio.get_event_loop()
    t0 = time.perf_counter()

    try:
        frame = await loop.run_in_executor(executor, _decode_frame, frame_b64)
        decode_done = time.perf_counter()
        results = await loop.run_in_executor(executor, lambda: _predict(model, frame))
    except Exception as exc:
        logger.error("inference_failed", error=str(exc))
        return None

    predict_done = time.perf_counter()
    decode_ms = (decode_done - t0) * 1000.0
    predict_ms = (predict_done - decode_done) * 1000.0
    latency_ms = (predict_done - t0) * 1000.0
    inference_latency_seconds.observe(latency_ms / 1000.0)

    keypoints = results[0].keypoints  # type: ignore[index]
    if keypoints is None or keypoints.xyn.shape[0] == 0:
        logger.info("no_person_detected", latency_ms=round(latency_ms, 1))
        return None

    kp_xyn: npt.NDArray[Any] = keypoints.xyn[0].cpu().numpy()  # (17, 2)
    kp_conf: npt.NDArray[Any] = keypoints.conf[0].cpu().numpy()  # (17,)

    logger.info(
        "inference_complete",
        latency_ms=round(latency_ms, 1),
        decode_ms=round(decode_ms, 1),
        predict_ms=round(predict_ms, 1),
    )
    return InferenceOutcome(
        kp_xyn=kp_xyn,
        kp_conf=kp_conf,
        latency_ms=latency_ms,
        decode_ms=decode_ms,
        predict_ms=predict_ms,
    )
