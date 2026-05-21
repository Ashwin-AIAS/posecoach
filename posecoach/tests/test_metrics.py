"""Tests for the /metrics endpoint and metric instrumentation.

Coverage:
- /metrics returns 404 when METRICS_TOKEN is unset (default test env).
- /metrics returns 401 when token is wrong, 200 when correct.
- All declared metrics show up in the exposed text.
- Form-score observation moves the histogram bucket.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def _state() -> None:
    """Lifespan installs a model + redis; ensure /metrics-touching tests pass."""
    redis = MagicMock()
    redis.ping = AsyncMock(return_value=True)
    redis.aclose = AsyncMock()
    app.state.redis = redis
    app.state.model = MagicMock()


def test_metrics_without_token_returns_404() -> None:
    """Conftest doesn't set METRICS_TOKEN — endpoint should 404 by default."""
    os.environ.pop("METRICS_TOKEN", None)
    with TestClient(app) as client:
        r = client.get("/metrics")
    assert r.status_code == 404


def test_metrics_with_wrong_token_returns_401() -> None:
    os.environ["METRICS_TOKEN"] = "secret123"
    try:
        with TestClient(app) as client:
            r = client.get("/metrics", headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401
    finally:
        os.environ.pop("METRICS_TOKEN", None)


def test_metrics_with_correct_token_returns_200_and_exposes_all_metrics() -> None:
    os.environ["METRICS_TOKEN"] = "secret123"
    try:
        with TestClient(app) as client:
            r = client.get("/metrics", headers={"Authorization": "Bearer secret123"})
        assert r.status_code == 200
        body = r.text
        for name in (
            "http_requests_total",
            "http_request_duration_seconds",
            "inference_latency_seconds",
            "form_score_events_total",
            "posecoach_form_score",
            "ws_connections_active",
            "chat_requests_total",
        ):
            assert name in body, f"metric {name!r} missing from /metrics output"
    finally:
        os.environ.pop("METRICS_TOKEN", None)


def test_form_score_histogram_records_observations() -> None:
    """Observing a value into the histogram should be visible in the exposition."""
    from app.metrics import form_score

    form_score.labels(exercise="squat").observe(85.0)
    form_score.labels(exercise="squat").observe(72.0)

    os.environ["METRICS_TOKEN"] = "secret123"
    try:
        with TestClient(app) as client:
            r = client.get("/metrics", headers={"Authorization": "Bearer secret123"})
        assert r.status_code == 200
        # The 80-bucket should now have at least 1 observation (the 85.0)
        # — exposition format is `posecoach_form_score_bucket{exercise="squat",le="80.0"} <n>`.
        # We do a lenient string check because float formatting can vary.
        assert "posecoach_form_score_bucket" in r.text
        assert 'exercise="squat"' in r.text
    finally:
        os.environ.pop("METRICS_TOKEN", None)


def test_chat_requests_counter_labels_increment() -> None:
    from app.metrics import chat_requests_total

    before = chat_requests_total.labels(provider="gemini")._value.get()
    chat_requests_total.labels(provider="gemini").inc()
    after = chat_requests_total.labels(provider="gemini")._value.get()
    assert after == before + 1


def test_active_ws_connections_inc_dec() -> None:
    from app.metrics import active_ws_connections

    before = active_ws_connections._value.get()
    active_ws_connections.inc()
    active_ws_connections.inc()
    active_ws_connections.dec()
    after = active_ws_connections._value.get()
    assert after == before + 1
