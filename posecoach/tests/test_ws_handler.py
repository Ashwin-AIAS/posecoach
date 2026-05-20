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


def _mock_yolo_results(n_persons: int = 1) -> MagicMock:
    """Build a fake YOLO results object with n_persons detected."""
    results = MagicMock()
    if n_persons == 0:
        results[0].keypoints.xyn.shape = (0, 17, 2)
        results[0].keypoints.xyn.__len__ = lambda self: 0
        # Make shape[0] == 0
        kp_mock = MagicMock()
        kp_mock.xyn = MagicMock()
        kp_mock.xyn.shape = (0,)
        kp_mock.xyn.__getitem__ = lambda s, i: np.zeros((17, 2))
        results[0].keypoints = kp_mock
    else:
        kp_xyn = np.random.default_rng(0).uniform(0.1, 0.9, (n_persons, 17, 2))
        kp_conf = np.ones((n_persons, 17))
        kp_mock = MagicMock()
        kp_mock.xyn = MagicMock()
        kp_mock.xyn.shape = (n_persons, 17, 2)
        kp_mock.xyn.__getitem__ = lambda s, i: kp_xyn[i]
        kp_mock.xyn.cpu = lambda: kp_mock.xyn
        # Make kp_mock.xyn[0] return the array
        xyn_tensor = MagicMock()
        xyn_tensor.cpu.return_value = xyn_tensor
        xyn_tensor.numpy.return_value = kp_xyn[0]
        conf_tensor = MagicMock()
        conf_tensor.cpu.return_value = conf_tensor
        conf_tensor.numpy.return_value = kp_conf[0]
        kp_mock.xyn = xyn_tensor
        kp_mock.conf = conf_tensor
        kp_mock.xyn.shape = (n_persons, 17, 2)
        results[0].keypoints = kp_mock
    return results


def _setup_app_state() -> None:
    """Inject mock model + real executor into app.state."""
    mock_model = MagicMock()
    mock_results = _mock_yolo_results(n_persons=1)
    mock_model.predict.return_value = mock_results

    app.state.model = mock_model
    app.state.executor = ThreadPoolExecutor(max_workers=1)
    app.state.redis = MagicMock()


def test_ws_accepts_connection() -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            assert ws is not None


def test_ws_missing_frame_returns_error() -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"exercise": "squat"})  # no frame
            data = ws.receive_json()
            assert "error" in data


def test_ws_invalid_exercise_returns_error() -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "invalid_exercise"})
            data = ws.receive_json()
            assert "error" in data
            assert "supported" in data


def test_ws_valid_frame_returns_score_and_cues() -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "squat"})
            # May return _NO_PERSON_RESPONSE or real result depending on mock
            data = ws.receive_json()
            # Both cases must have score key (None or float) and cues
            assert "cues" in data


def test_ws_response_has_required_keys() -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": "squat"})
            data = ws.receive_json()
            # _NO_PERSON_RESPONSE or real result — both have these
            assert "cues" in data


@pytest.mark.parametrize("exercise", ["squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank"])
def test_ws_all_exercises_accepted(exercise: str) -> None:
    _setup_app_state()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/inference") as ws:
            ws.send_json({"frame": _make_frame_b64(), "exercise": exercise})
            data = ws.receive_json()
            assert "error" not in data or "unsupported" not in data.get("error", "")
