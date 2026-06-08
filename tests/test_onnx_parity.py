"""Parity + contract tests for the direct ONNX Runtime pose path.

These assert that ``OnnxPoseSession`` decodes keypoints identically to the
Ultralytics ``.pt`` model (within a small tolerance) so the switch to ONNX
changes only latency, not scoring behaviour.

The ``.pt`` model and ``ultralytics`` are unavailable at test time (ultralytics
is stubbed in ``conftest``), so the expected keypoints are captured offline into
``fixtures/onnx_parity.npz`` (frames + .pt kp_xyn/kp_conf, generated from the
public ultralytics sample images). The test runs only the real ONNX session
against that fixture. It skips cleanly when the ~12 MB ONNX model has not been
pulled from git-lfs (e.g. a lean CI runner).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

_ROOT = Path(__file__).resolve().parents[1]
_MODEL = _ROOT / "models" / "yolo_posecoach_v1_320.onnx"
_FIXTURE = Path(__file__).parent / "fixtures" / "onnx_parity.npz"

# An LFS-pointer stub is <1 KB; the real model is ~12 MB. Skip when not pulled.
_MODEL_AVAILABLE = _MODEL.exists() and _MODEL.stat().st_size > 1_000_000

pytestmark = pytest.mark.skipif(
    not _MODEL_AVAILABLE,
    reason="320 ONNX model not pulled from git-lfs",
)


def _session() -> object:
    from app.inference.onnx_session import OnnxPoseSession

    return OnnxPoseSession(str(_MODEL))


def test_onnx_parity_with_pt() -> None:
    """ONNX keypoints match the .pt keypoints captured in the fixture."""
    data = np.load(_FIXTURE)
    frames, pt_xyn, pt_conf = data["frames"], data["pt_xyn"], data["pt_conf"]
    sess = _session()
    for i in range(frames.shape[0]):
        out = sess.predict(frames[i])  # type: ignore[attr-defined]
        assert out is not None, f"frame {i}: ONNX returned no detection"
        kp_xyn, kp_conf = out
        xy_mad = float(np.mean(np.abs(kp_xyn - pt_xyn[i])))
        conf_mad = float(np.mean(np.abs(kp_conf - pt_conf[i])))
        # Tolerance ~0.01 normalized ≈ 3 px at 320; observed parity is ~0.
        assert xy_mad < 0.01, f"frame {i}: xy MAD {xy_mad:.5f} exceeds tolerance"
        assert conf_mad < 0.02, f"frame {i}: conf MAD {conf_mad:.5f} exceeds tolerance"


def test_onnx_no_person_returns_none() -> None:
    """A blank frame yields no detection above the confidence threshold."""
    sess = _session()
    blank = np.zeros((sess.imgsz, sess.imgsz, 3), dtype=np.uint8)  # type: ignore[attr-defined]
    assert sess.predict(blank) is None  # type: ignore[attr-defined]


def test_onnx_output_contract() -> None:
    """Decoded shapes match the (17,2)/(17,) contract the scorer expects."""
    data = np.load(_FIXTURE)
    sess = _session()
    out = sess.predict(data["frames"][0])  # type: ignore[attr-defined]
    assert out is not None
    kp_xyn, kp_conf = out
    assert kp_xyn.shape == (17, 2)
    assert kp_conf.shape == (17,)
    assert kp_xyn.dtype == np.float32
