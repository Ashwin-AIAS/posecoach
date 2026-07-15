"""P32: the /api/v1/model/pose.onnx route serves the exact deployed model file."""

from pathlib import Path

import pytest
from httpx import AsyncClient

FAKE_ONNX = b"\x08\x01fake-onnx-graph-bytes"


async def test_pose_model_serves_model_path_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = tmp_path / "model.onnx"
    model.write_bytes(FAKE_ONNX)
    monkeypatch.setenv("MODEL_PATH", str(model))

    resp = await client.get("/api/v1/model/pose.onnx")

    assert resp.status_code == 200
    assert resp.content == FAKE_ONNX
    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers["cache-control"] == "public, max-age=86400"


async def test_pose_model_pt_weights_returns_404(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Dev/test environments run the .pt fallback — the browser can't use it.
    monkeypatch.setenv("MODEL_PATH", "models/yolo_posecoach_v1.pt")

    resp = await client.get("/api/v1/model/pose.onnx")

    assert resp.status_code == 404


async def test_pose_model_missing_file_returns_404(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MODEL_PATH", str(tmp_path / "nope.onnx"))

    resp = await client.get("/api/v1/model/pose.onnx")

    assert resp.status_code == 404


async def test_pose_model_strips_stray_whitespace_in_env(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Mirrors the lifespan's .strip() guard for a stray space in the Space var.
    model = tmp_path / "model.onnx"
    model.write_bytes(FAKE_ONNX)
    monkeypatch.setenv("MODEL_PATH", f" {model} ")

    resp = await client.get("/api/v1/model/pose.onnx")

    assert resp.status_code == 200
    assert resp.content == FAKE_ONNX
