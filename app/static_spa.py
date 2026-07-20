"""Same-origin SPA serving — mount the built frontend from the Space image.

This module is imported by ``app.main`` and conditionally called when
``/app/static/index.html`` exists (i.e. inside the Docker image that ran the
multi-stage frontend build). When the directory is absent — local dev, pytest,
CI — nothing is mounted and the app behaves exactly as before P30.

The SPA fallback returns ``index.html`` for any path that does **not** match a
reserved API prefix. Reserved prefixes (``/api``, ``/ws``, ``/docs``, etc.)
are explicitly excluded so FastAPI's own routers always win.
"""
from __future__ import annotations

from pathlib import Path
from typing import Final

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

logger = structlog.get_logger(__name__)

# Paths that must never be intercepted by the SPA catch-all.
# Checked as prefix matches against the request path.
_RESERVED_PREFIXES: Final[tuple[str, ...]] = (
    "/api",
    "/ws",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/metrics",
    "/health",
)

# Tag applied to routes added by mount_spa so unmount_spa can remove them.
_SPA_ROUTE_TAG: Final[str] = "__spa_route__"

# --- Cache-Control policies -------------------------------------------------
# Entry points (index.html, sw.js, registerSW.js, manifest) MUST revalidate on
# every load so a returning browser can never boot a superseded shell. ``no-cache``
# already forces revalidation; ``must-revalidate`` forbids serving a stale copy if
# revalidation fails. Never give these a positive max-age.
_ENTRY_CACHE: Final[str] = "no-cache, must-revalidate"

# Everything under /assets/ is content-hashed by Vite (verified: every emitted
# filename carries an 8-char hash, including the on-demand ort-wasm binary), so a
# changed file always gets a new URL. That makes a one-year immutable cache safe
# and eliminates the revalidation round-trip on repeat loads.
_ASSET_CACHE: Final[str] = "public, max-age=31536000, immutable"

# Non-hashed static files served from the SPA root (icons, favicon). Short-lived
# so a rebranded icon propagates within a day without pinning it for a year.
_STATIC_FILE_CACHE: Final[str] = "public, max-age=86400"


class _ImmutableStaticFiles(StaticFiles):
    """StaticFiles that stamps a long-lived immutable Cache-Control on 200s.

    Starlette's ``StaticFiles`` sets only ``ETag``/``Last-Modified`` and would
    otherwise force a revalidation round-trip on every asset. Every file under
    ``/assets/`` is content-hashed, so a year-long immutable cache is safe.
    """

    async def get_response(self, path: str, scope: object) -> Response:
        response = await super().get_response(path, scope)  # type: ignore[arg-type]
        if response.status_code == 200:
            response.headers["Cache-Control"] = _ASSET_CACHE
        return response


def mount_spa(app: FastAPI, static_dir: str) -> None:
    """Mount the SPA static files and catch-all fallback onto *app*.

    Parameters
    ----------
    app:
        The FastAPI application instance.
    static_dir:
        Absolute path to the directory containing the built frontend
        (``index.html``, ``assets/``, icons, etc.).
    """
    static_path = Path(static_dir)
    index_html = static_path / "index.html"

    if not index_html.is_file():
        logger.debug("spa_mount_skipped", reason="index.html not found", dir=static_dir)
        return

    assets_dir = static_path / "assets"

    # --- Hashed assets (immutable, long-lived cache) ---
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            _ImmutableStaticFiles(directory=str(assets_dir)),
            name="spa_assets",
        )

    # --- Well-known PWA / browser files served from static root ---
    _pwa_files = {
        "/manifest.webmanifest": "manifest.webmanifest",
        "/sw.js": "sw.js",
        "/registerSW.js": "registerSW.js",
        "/favicon-32.png": "favicon-32.png",
        "/icon-180.png": "icon-180.png",
        "/icon-192.png": "icon-192.png",
        "/icon-512.png": "icon-512.png",
    }

    for url_path, filename in _pwa_files.items():
        file_path = static_path / filename
        if file_path.is_file():
            _register_static_file(app, url_path, file_path, filename)

    # --- Root ``/`` and SPA catch-all ---
    _index_str = str(index_html)

    @app.get("/", include_in_schema=False, tags=[_SPA_ROUTE_TAG])
    async def _spa_root() -> FileResponse:
        return FileResponse(_index_str, media_type="text/html", headers={"Cache-Control": _ENTRY_CACHE})

    @app.get("/{path:path}", include_in_schema=False, tags=[_SPA_ROUTE_TAG])
    async def _spa_fallback(request: Request, path: str) -> Response:
        # Never intercept reserved prefixes — let FastAPI's own routes handle them.
        req_path = request.url.path
        for prefix in _RESERVED_PREFIXES:
            if req_path == prefix or req_path.startswith(prefix + "/"):
                # Return a minimal 404 so FastAPI's normal error handling kicks in.
                # This branch should rarely fire because FastAPI matches explicit
                # routes before catch-all, but it's a safety net.
                from fastapi.responses import JSONResponse

                return JSONResponse(status_code=404, content={"detail": "Not Found"})

        return FileResponse(_index_str, media_type="text/html", headers={"Cache-Control": _ENTRY_CACHE})

    logger.info("spa_mounted", static_dir=static_dir)


def _register_static_file(app: FastAPI, url_path: str, file_path: Path, name: str) -> None:
    """Register a single static file route with appropriate cache headers."""
    file_str = str(file_path)
    # sw.js / registerSW.js / manifest must always revalidate (SW update
    # semantics); icons are content-stable enough for a short positive cache.
    no_cache = name in ("sw.js", "registerSW.js", "manifest.webmanifest")
    cache_header = _ENTRY_CACHE if no_cache else _STATIC_FILE_CACHE

    @app.get(url_path, include_in_schema=False, tags=[_SPA_ROUTE_TAG], name=f"spa_{name}")
    async def _serve(
        _file_str: str = file_str,
        _cache_header: str = cache_header,
    ) -> FileResponse:
        return FileResponse(_file_str, headers={"Cache-Control": _cache_header})


def unmount_spa(app: FastAPI) -> None:
    """Remove all SPA routes added by ``mount_spa`` — used in test teardown."""
    # Remove catch-all and static file routes
    app.routes[:] = [
        r
        for r in app.routes
        if not (hasattr(r, "tags") and _SPA_ROUTE_TAG in getattr(r, "tags", []))
    ]
    # Also remove the /assets mount if present
    app.routes[:] = [
        r for r in app.routes if not (hasattr(r, "name") and getattr(r, "name", "") == "spa_assets")
    ]
