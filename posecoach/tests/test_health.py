"""Health endpoint tests — /health (shallow) and /health/deep (deep).

/health/deep must return 503 (not 200) if any dependency is down, per the
thesis privacy/reliability requirements in CLAUDE.md.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from starlette.testclient import TestClient

from app.main import app


def _install_app_state() -> None:
    """Replace state set by lifespan with values that pass the deep check."""
    redis = MagicMock()
    redis.ping = AsyncMock(return_value=True)
    redis.aclose = AsyncMock()
    app.state.redis = redis
    app.state.model = MagicMock()


def test_health_simple_returns_ok() -> None:
    with TestClient(app) as client:
        _install_app_state()
        r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_deep_all_ok_returns_200() -> None:
    with TestClient(app) as client:
        _install_app_state()
        r = client.get("/health/deep")
    assert r.status_code == 200
    body = r.json()
    assert body["postgres"] == "ok"
    assert body["redis"] == "ok"
    assert body["model"] == "ok"


def test_health_deep_redis_down_returns_503() -> None:
    with TestClient(app) as client:
        _install_app_state()
        broken_redis = MagicMock()
        broken_redis.ping = AsyncMock(side_effect=RuntimeError("redis unreachable"))
        broken_redis.aclose = AsyncMock()
        app.state.redis = broken_redis
        r = client.get("/health/deep")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["redis"] == "error"


def test_health_deep_model_not_loaded_returns_503() -> None:
    with TestClient(app) as client:
        _install_app_state()
        app.state.model = None
        r = client.get("/health/deep")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["model"] == "error"
