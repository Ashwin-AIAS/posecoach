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

from app.inference.onnx_session import OnnxPoseSession
from app.metrics import inference_latency_seconds

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class InferenceOutcome:
    """First-person keypoints plus a P11 timing breakdown for one frame.

    ``latency_ms`` is the end-to-end decode+predict slice. ``decode_ms`` and
    ``predict_ms`` split that slice so the WS handler can attribute per-stage
    cost; they are instrumentation only.
    """

    kp_xyn: npt.NDArray[Any]
    kp_conf: npt.NDArray[Any]
    latency_ms: float
    decode_ms: float
    predict_ms: float


# PyTorch fallback inference size. The ONNX path uses the size baked into the
# graph (``OnnxPoseSession.imgsz``). Both decode straight to the inference size
# — no more decode-to-640-then-let-YOLO-downscale-to-320 double resize, which was
# ~78 ms p95 of pure waste in production.
_PT_INFERENCE_SIZE = 320
# conf=0.10: the fine-tuned model trained on Vicon/Fit3D (studio); webcam input
# has a different distribution, so the default 0.25 threshold filters everything.
_PT_CONF_THRESHOLD = 0.10
_VRAM_CLEAR_EVERY = 100
_frame_counter = 0


def _model_input_size(model: object) -> int:
    """Square input size (px) the loaded model expects."""
    if isinstance(model, OnnxPoseSession):
        return model.imgsz
    return _PT_INFERENCE_SIZE


def _decode_frame(frame_b64: str, size: int) -> npt.NDArray[np.uint8]:
    """Base64 JPEG → (size, size, 3) uint8 RGB array, resized to the model size."""
    raw = base64.b64decode(frame_b64)
    img = (
        Image.open(BytesIO(raw))
        .convert("RGB")
        .resize((size, size), Image.Resampling.BILINEAR)
    )
    return np.array(img, dtype=np.uint8)


def _predict(
    model: object, frame: npt.NDArray[np.uint8]
) -> tuple[npt.NDArray[Any], npt.NDArray[Any]] | None:
    """Run one frame through the ONNX session or the PyTorch model.

    Synchronous — runs in the thread executor, never on the async loop. Returns
    ``(kp_xyn (17,2) normalized, kp_conf (17,))`` for the first detected person,
    or ``None`` if no person is detected.
    """
    global _frame_counter

    if isinstance(model, OnnxPoseSession):
        return model.predict(frame)

    # PyTorch (.pt) path — dev/local convenience. NMS-free one-to-one head; never
    # pass end2end=False (it switches to the NMS head and breaks keypoint parsing).
    _frame_counter += 1
    results = model.predict(  # type: ignore[attr-defined]
        frame, verbose=False, conf=_PT_CONF_THRESHOLD, imgsz=_PT_INFERENCE_SIZE
    )

    # Periodically clear GPU VRAM to prevent OOM (no-op on CPU / ONNX path).
    if _frame_counter % _VRAM_CLEAR_EVERY == 0:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    keypoints = results[0].keypoints
    if keypoints is None or keypoints.xyn.shape[0] == 0:
        return None
    kp_xyn: npt.NDArray[Any] = keypoints.xyn[0].cpu().numpy()  # (17, 2)
    kp_conf: npt.NDArray[Any] = keypoints.conf[0].cpu().numpy()  # (17,)
    return kp_xyn, kp_conf


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
    size = _model_input_size(model)
    t0 = time.perf_counter()

    try:
        frame = await loop.run_in_executor(executor, _decode_frame, frame_b64, size)
        decode_done = time.perf_counter()
        prediction = await loop.run_in_executor(executor, lambda: _predict(model, frame))
    except Exception as exc:
        logger.error("inference_failed", error=str(exc))
        return None

    predict_done = time.perf_counter()
    decode_ms = (decode_done - t0) * 1000.0
    predict_ms = (predict_done - decode_done) * 1000.0
    latency_ms = (predict_done - t0) * 1000.0
    inference_latency_seconds.observe(latency_ms / 1000.0)

    if prediction is None:
        logger.info("no_person_detected", latency_ms=round(latency_ms, 1))
        return None

    kp_xyn, kp_conf = prediction
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
