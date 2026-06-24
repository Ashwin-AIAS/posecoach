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


# PyTorch fallback inference size (dev/local convenience only). The production
# ONNX path uses the size baked into the graph (``OnnxPoseSession.imgsz`` — 640
# for the deployed model). Both decode straight to the inference size, so there
# is no decode-to-640-then-downscale double resize. The PT fallback stays at 320
# because it is only a local sanity path; production accuracy comes from the 640
# ONNX (docs/enhancements/FIX_POSE_TRACKING_QUALITY.md).
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


@dataclass(frozen=True)
class LetterboxMeta:
    """Inverse-transform parameters for one letterboxed decode.

    Lets ``run_inference`` map model-space (square, padded) keypoints back to
    the original sent frame's aspect, instead of the old square-stretch which
    distorted non-4:3 (e.g. 16:9 back-camera) frames before the model ever
    saw them.
    """

    size: int  # square side fed to the model
    scale: float  # min(size/w0, size/h0)
    pad_x: int  # left pad (px, in the square)
    pad_y: int  # top pad
    new_w: int  # resized content width  (w0*scale)
    new_h: int  # resized content height (h0*scale)
    src_w: int  # original sent-frame width  w0
    src_h: int  # original sent-frame height h0


# YOLO's standard letterbox pad color.
_LETTERBOX_PAD = (114, 114, 114)


def _decode_frame(frame_b64: str, size: int) -> tuple[npt.NDArray[np.uint8], LetterboxMeta]:
    """Base64 JPEG → (size, size, 3) uint8 RGB array, letterboxed (aspect-preserved + padded).

    Replaces the old non-aspect-preserving square stretch, which squished
    non-square frames (e.g. a 16:9 back camera) before inference, degrading
    keypoint confidence. The returned :class:`LetterboxMeta` lets the caller
    invert the transform on the model's output keypoints.
    """
    raw = base64.b64decode(frame_b64)
    img = Image.open(BytesIO(raw)).convert("RGB")
    w0, h0 = img.size
    scale = min(size / w0, size / h0)
    new_w, new_h = max(1, round(w0 * scale)), max(1, round(h0 * scale))
    resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (size, size), _LETTERBOX_PAD)
    pad_x, pad_y = (size - new_w) // 2, (size - new_h) // 2
    canvas.paste(resized, (pad_x, pad_y))
    meta = LetterboxMeta(size, scale, pad_x, pad_y, new_w, new_h, w0, h0)
    return np.array(canvas, dtype=np.uint8), meta


def _unletterbox_xyn(kp_xyn: npt.NDArray[Any], meta: LetterboxMeta) -> npt.NDArray[Any]:
    """Map square-normalized keypoints back to the original sent frame's aspect.

    square-normalized -> square px -> remove pad -> normalize to original frame.
    """
    px = kp_xyn[:, 0] * meta.size - meta.pad_x
    py = kp_xyn[:, 1] * meta.size - meta.pad_y
    out = np.empty_like(kp_xyn)
    out[:, 0] = np.clip(px / meta.new_w, 0.0, 1.0)
    out[:, 1] = np.clip(py / meta.new_h, 0.0, 1.0)
    return out


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
        frame, meta = await loop.run_in_executor(executor, _decode_frame, frame_b64, size)
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

    kp_xyn_square, kp_conf = prediction
    # Both the PyTorch and ONNX paths return keypoints normalized to the square
    # model input (post-letterbox); invert the pad/scale so the contract at the
    # WS boundary is unchanged — keypoints normalized to the original sent frame.
    kp_xyn = _unletterbox_xyn(kp_xyn_square, meta)
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
