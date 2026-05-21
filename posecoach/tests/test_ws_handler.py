"""WebSocket inference endpoint — integration tests with mocked YOLO."""
from __future__ import annotations

import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from PIL import Image
from starlette.testclient import TestClient

os.environ.setdefault("POSTGRES_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test_secret_at_least_32_chars_long_ok")
os.environ.setdefault("MODEL_PATH", "models/yolo_posecoach_v1.onnx")

from app.main import app


def _make_frame_b64() -> str:
    """Create a minimal 32×32 white JPEG as base64."""
    img = Image.new("RGB", (32, 32), color=(200, 200, 200))
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _make_tensor_mock(arr: np.ndarray) -> MagicMock:
    """Build a MagicMock that mimics a torch tensor: `.cpu().numpy()` → arr."""
    t = MagicMock()
    t.cpu.return_value = t
    t.numpy.return_value = arr
    return t


def _mock_yolo_results(n_persons: int = 1) -> MagicMock:
    """Build a fake YOLO results object with n_persons detected.

    Mirrors the YOLO26 one-to-one head shape: `results[0].keypoints.xyn`
    is the per-person stack (shape (N, 17, 2)) and `keypoints.xyn[i]` is
    a tensor with `.cpu().numpy()` → (17, 2) ndarray.
    """
    results = MagicMock()

    if n_persons == 0:
        kp_xyn_stack = MagicMock()
        kp_xyn_stack.shape = (0, 17, 2)
        kp_mock = MagicMock()
        kp_mock.xyn = kp_xyn_stack
        results.__getitem__.return_value.keypoints = kp_mock
        return results

    kp_xyn = np.random.default_rng(0).uniform(0.1, 0.9, (n_persons, 17, 2))
    kp_conf = np.ones((n_persons, 17), dtype=np.float32)

    # xyn — runner accesses .shape AND .xyn[0].cpu().numpy()
    xyn_stack = MagicMock()
    xyn_stack.shape = (n_persons, 17, 2)
    xyn_stack.__getitem__.side_effect = lambda i: _make_tensor_mock(kp_xyn[i])

    conf_stack = MagicMock()
    conf_stack.shape = (n_persons, 17)
    conf_stack.__getitem__.side_effect = lambda i: _make_tensor_mock(kp_conf[i])

    kp_mock = MagicMock()
    kp_mock.xyn = xyn_stack
    kp_mock.conf = conf_stack
    results.__getitem__.return_value.keypoints = kp_mock
    return results


def _override_app_state(n_persons: int = 1) -> None:
    """Override app.state with a real-ish YOLO mock and a thread executor.

    MUST be called AFTER the TestClient lifespan has started — otherwise the
    lifespan's `YOLO(model_path)` (from the stubbed ultralytics module) will
    overwrite app.state.model with a generic MagicMock and inference output
    will be unusable.
    """
    mock_model = MagicMock()
    mock_results = _mock_yolo_results(n_persons=n_persons)
    mock_model.predict.return_value = mock_results

    app.state.model = mock_model
    app.state.executor = ThreadPoolExecutor(max_workers=1)
    # Note: app.state.redis is set by the lifespan to the stubbed AsyncMock-
    # backed client from conftest — don't replace it, or shutdown will fail
    # on `await client.aclose()`.


def test_ws_accepts_connection() -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            assert ws is not None


def test_ws_missing_frame_returns_error() -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"exercise": "squat"})  # no frame
            data = ws.receive_json()
            assert "error" in data


def test_ws_invalid_exercise_returns_error() -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "invalid_exercise"})
            data = ws.receive_json()
            assert "error" in data
            assert "supported" in data


def test_ws_valid_frame_returns_score_and_cues() -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "squat"})
            data = ws.receive_json()
            assert "cues" in data
            assert "score" in data
            assert "latency_ms" in data


def test_ws_response_has_required_keys() -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "squat"})
            data = ws.receive_json()
            for key in ("keypoints", "confidence", "score", "cues", "latency_ms"):
                assert key in data


@pytest.mark.parametrize("exercise", ["squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank"])
def test_ws_all_exercises_accepted(exercise: str) -> None:
    with TestClient(app) as client:
        _override_app_state()
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": exercise})
            data = ws.receive_json()
            assert "error" not in data or "unsupported" not in data.get("error", "")
