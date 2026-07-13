"""SPA fallback tests — ensure API/WS/docs/metrics/health routes are never shadowed.

The static mount is conditionally applied in ``app.main`` only when
``/app/static/index.html`` exists. In the test environment that file is absent,
so these tests verify both:

1. **Without static dir** (the default): the app starts normally and all API
   routes work — the mount is cleanly skipped.
2. **With a temporary static dir**: the SPA fallback returns ``index.html``
   for unknown browser paths but never intercepts reserved prefixes.
"""
from __future__ import annotations

import os
import textwrap
from pathlib import Path
from typing import Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.testclient import TestClient


def _install_app_state_on(application: object) -> None:
    """Inject minimal app.state so health checks don't crash."""
    from app.main import app

    redis = MagicMock()
    redis.ping = AsyncMock(return_value=True)
    redis.aclose = AsyncMock()
    app.state.redis = redis
    app.state.model = MagicMock()


# ---------------------------------------------------------------------------
# Group 1: static dir ABSENT — mount must be skipped, existing routes intact
# ---------------------------------------------------------------------------

class TestStaticDirAbsent:
    """When /app/static is missing the app must behave exactly as before P30."""

    def test_health_still_works(self) -> None:
        from app.main import app

        with TestClient(app) as client:
            _install_app_state_on(app)
            r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_docs_still_works(self) -> None:
        from app.main import app

        with TestClient(app) as client:
            _install_app_state_on(app)
            r = client.get("/docs")
        assert r.status_code == 200

    def test_openapi_json_still_works(self) -> None:
        from app.main import app

        with TestClient(app) as client:
            _install_app_state_on(app)
            r = client.get("/openapi.json")
        assert r.status_code == 200

    def test_unknown_path_returns_404_not_html(self) -> None:
        """Without static dir an unknown path should 404, not serve index.html."""
        from app.main import app

        with TestClient(app) as client:
            _install_app_state_on(app)
            r = client.get("/workouts")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Group 2: static dir PRESENT — SPA fallback active, reserved routes safe
# ---------------------------------------------------------------------------

@pytest.fixture()
def spa_app(tmp_path: Path) -> Generator[object, None, None]:
    """Create a temporary static dir and re-mount the SPA, then clean up."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    assets_dir = static_dir / "assets"
    assets_dir.mkdir()
    (static_dir / "index.html").write_text(
        "<!doctype html><html><body>SPA shell</body></html>"
    )
    (assets_dir / "index-abc123.js").write_text("console.log('app')")

    # Import fresh and mount
    from app.main import app
    from app.static_spa import mount_spa

    mount_spa(app, str(static_dir))

    _install_app_state_on(app)
    yield app

    # Teardown: remove the SPA routes so subsequent tests get a clean app.
    # The mount adds routes at the end; pop them.
    from app.static_spa import unmount_spa

    unmount_spa(app)


class TestSpaFallbackActive:
    """With the static dir present the SPA fallback must serve index.html
    for browser routes but NEVER shadow reserved API paths."""

    def test_root_serves_index_html(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/")
        assert r.status_code == 200
        assert "SPA shell" in r.text

    def test_unknown_path_serves_spa_fallback(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/workouts")
        assert r.status_code == 200
        assert "SPA shell" in r.text

    def test_nested_unknown_path_serves_spa(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/workouts/123/sets")
        assert r.status_code == 200
        assert "SPA shell" in r.text

    def test_assets_served(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/assets/index-abc123.js")
        assert r.status_code == 200
        assert "console.log" in r.text

    # --- Reserved paths must NOT be intercepted ---

    def test_api_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/api/v1/health")  # Should hit FastAPI, not SPA
        # Expect the actual API response (could be 404 for non-existent route,
        # but never the HTML shell)
        assert "SPA shell" not in r.text

    def test_health_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_health_deep_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/health/deep")
        # May be 200 or 503 depending on mocked state, but never SPA HTML
        assert "SPA shell" not in r.text

    def test_docs_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/docs")
        assert r.status_code == 200
        assert "SPA shell" not in r.text

    def test_openapi_json_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/openapi.json")
        assert r.status_code == 200
        assert "SPA shell" not in r.text

    def test_metrics_not_shadowed(self, spa_app: object) -> None:
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/metrics")
        # 401 or 404 depending on METRICS_TOKEN — never the SPA shell
        assert "SPA shell" not in r.text

    def test_ws_path_not_shadowed(self, spa_app: object) -> None:
        """WS upgrade paths must not be caught by the SPA fallback."""
        from app.main import app

        with TestClient(app) as client:
            r = client.get("/ws/inference")
        # Should get a 4xx (not a WS upgrade from GET), never the SPA shell
        assert "SPA shell" not in r.text
