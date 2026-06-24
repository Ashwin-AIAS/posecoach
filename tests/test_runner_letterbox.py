"""Letterbox decode + un-letterbox round-trip (back-camera pose quality fix).

Guards against regressing to the old non-aspect-preserving square-stretch,
which squished 16:9 back-camera frames before inference and tanked keypoint
confidence (docs/enhancements/FIX_BACK_CAMERA_POSE_QUALITY.md).
"""
from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.inference.runner import LetterboxMeta, _decode_frame, _unletterbox_xyn

_MODEL_SIZE = 320
# Production model input size (docs/enhancements/FIX_POSE_TRACKING_QUALITY.md):
# the 320 model lost too much keypoint accuracy at mirror distance.
_PROD_MODEL_SIZE = 640
_PROD_ONNX = Path("models/yolo_posecoach_v1.onnx")


def _jpeg_b64(width: int, height: int) -> str:
    img = Image.new("RGB", (width, height), (50, 100, 150))
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_letterbox_square_frame_is_identity() -> None:
    """A 1:1 source frame needs no padding — content fills the square exactly."""
    frame, meta = _decode_frame(_jpeg_b64(200, 200), _MODEL_SIZE)
    assert meta.pad_x == 0
    assert meta.pad_y == 0
    assert meta.new_w == _MODEL_SIZE
    assert meta.new_h == _MODEL_SIZE
    assert frame.shape == (_MODEL_SIZE, _MODEL_SIZE, 3)


def test_letterbox_wide_frame_preserves_aspect() -> None:
    """A 16:9 frame is NOT squished — its resized content keeps the source aspect."""
    src_w, src_h = 1280, 720
    _, meta = _decode_frame(_jpeg_b64(src_w, src_h), _MODEL_SIZE)

    # Padding lands on the vertical axis (wide content, square canvas).
    assert meta.pad_y > 0
    assert meta.pad_x == 0

    # The resized content's aspect ratio must match the source's, within
    # rounding — this is the property the old square-stretch broke.
    src_aspect = src_w / src_h
    resized_aspect = meta.new_w / meta.new_h
    assert resized_aspect == pytest.approx(src_aspect, rel=1e-2)


def test_unletterbox_round_trips_a_known_point() -> None:
    """A keypoint at a known original-frame location survives letterbox + invert."""
    src_w, src_h = 1280, 720
    _, meta = _decode_frame(_jpeg_b64(src_w, src_h), _MODEL_SIZE)

    # A point at (0.3, 0.6) of the original frame.
    orig_x, orig_y = 0.3, 0.6
    px, py = orig_x * src_w, orig_y * src_h

    # Forward-project into square-normalized space, as the model would see it.
    square_x = (px * meta.scale + meta.pad_x) / meta.size
    square_y = (py * meta.scale + meta.pad_y) / meta.size
    kp_xyn = np.array([[square_x, square_y]], dtype=np.float32)

    out = _unletterbox_xyn(kp_xyn, meta)
    assert out[0, 0] == pytest.approx(orig_x, abs=1e-3)
    assert out[0, 1] == pytest.approx(orig_y, abs=1e-3)


def test_unletterbox_clips_to_valid_range() -> None:
    """Out-of-bounds square coords (e.g. into the pad) clip to [0, 1], never NaN/negatives."""
    meta = LetterboxMeta(
        size=320, scale=0.5, pad_x=0, pad_y=40, new_w=320, new_h=240, src_w=640, src_h=480
    )
    kp_xyn = np.array([[0.0, 0.0], [1.0, 1.0]], dtype=np.float32)  # top-left pad, bottom-right pad
    out = _unletterbox_xyn(kp_xyn, meta)
    assert np.all(out >= 0.0)
    assert np.all(out <= 1.0)


def test_unletterbox_round_trips_a_known_point_at_640() -> None:
    """The letterbox round-trip holds at the production imgsz 640, not just 320.

    Guards FIX_POSE_TRACKING_QUALITY Phase 1: raising the model input from 320 to
    640 must not disturb the aspect-preserving decode/invert contract.
    """
    src_w, src_h = 1280, 720
    _, meta = _decode_frame(_jpeg_b64(src_w, src_h), _PROD_MODEL_SIZE)
    assert meta.size == _PROD_MODEL_SIZE

    orig_x, orig_y = 0.42, 0.58
    px, py = orig_x * src_w, orig_y * src_h
    square_x = (px * meta.scale + meta.pad_x) / meta.size
    square_y = (py * meta.scale + meta.pad_y) / meta.size
    out = _unletterbox_xyn(np.array([[square_x, square_y]], dtype=np.float32), meta)
    assert out[0, 0] == pytest.approx(orig_x, abs=1e-3)
    assert out[0, 1] == pytest.approx(orig_y, abs=1e-3)


def test_capture_frame_encodes_under_max_frame_bytes() -> None:
    """A 512-long-side capture base64-encodes well under the backend frame cap.

    Phase 2 raised the capture long-side to 512 and the cap to 512 KB; confirm the
    worst case (incompressible noise — denser than any real frame) still fits, so a
    legitimate frame is never rejected.
    """
    from app.api.v1.ws_inference import MAX_FRAME_BYTES

    rng = np.random.default_rng(0)
    arr = rng.integers(0, 256, (512, 512, 3), dtype=np.uint8)  # worst-case 512x512 noise
    buf = BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="JPEG", quality=60)
    b64_len = len(base64.b64encode(buf.getvalue()))
    assert b64_len < MAX_FRAME_BYTES, f"512px noise frame encodes to {b64_len} >= cap {MAX_FRAME_BYTES}"


@pytest.mark.skipif(not _PROD_ONNX.exists(), reason="production ONNX model not present (Git-LFS)")
def test_onnx_session_consecutive_calls_keep_keypoint_contract() -> None:
    """The direct ONNX session must keep its keypoint contract across consecutive calls.

    The old Ultralytics-ONNX path returned ``keypoints=None`` on the 2nd+ predict
    (task silently reset to ``detect``). ``OnnxPoseSession`` is a direct
    onnxruntime session and is immune; this locks that in so any future
    model/decode change can't silently regress. Synthetic frames usually detect no
    person (→ None), which is fine — the assertion is that every call returns
    either None or a sane (17,2)/(17,) finite result, never a degraded shape or a
    raise on a later call. (The real person-detection check is
    scripts/validate_consecutive_frames.py.)
    """
    from app.inference.onnx_session import OnnxPoseSession

    session = OnnxPoseSession(str(_PROD_ONNX))
    rng = np.random.default_rng(1)
    for i in range(8):
        frame = rng.integers(0, 256, (session.imgsz, session.imgsz, 3), dtype=np.uint8)
        out = session.predict(frame)
        assert out is None or (
            out[0].shape == (17, 2)
            and out[1].shape == (17,)
            and bool(np.isfinite(out[0]).all())
            and bool(np.isfinite(out[1]).all())
        ), f"call {i} broke the keypoint contract: {out!r}"
