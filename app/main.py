import os
import secrets
from collections.abc import AsyncGenerator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import structlog
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from ultralytics import YOLO

from app import db
from app.api.v1.auth import router as auth_router
from app.api.v1.chat import router as chat_router
from app.api.v1.history import router as history_router
from app.api.v1.ws_inference import router as ws_router
from app.cache import create_redis_client
from app.logging_config import setup_logging
from app.metrics import registry as metrics_registry
from app.middleware import RequestIdMiddleware, SecurityHeadersMiddleware, TimingMiddleware
from app.rate_limit import limiter

logger = structlog.get_logger(__name__)


def _rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=429, content={"detail": "rate limit exceeded"})


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort 500 handler — never leak a stack trace to the client.

    FastAPI's own ``HTTPException`` handler still owns 4xx responses; this only
    fires for genuinely unhandled exceptions, returning a stable JSON shape.
    """
    logger.error("unhandled_exception", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=500, content={"error": "internal server error", "code": 500})


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging()

    log = structlog.get_logger(__name__)
    log.info("startup_begin")

    # Load YOLO26 model once — 3-5s, stored in app.state for all requests
    model_path = os.environ["MODEL_PATH"]

    # Ultralytics 8.4.x has an ONNX predictor-state bug where results[0].keypoints
    # returns None on the 2nd+ inference because the predictor's task arg gets reset.
    # Use the PT model when available — it avoids the bug with full Pose26 support.
    if model_path.endswith(".onnx"):
        pt_path = model_path[:-5] + ".pt"
        if os.path.exists(pt_path):
            log.info("pt_preferred_over_onnx", pt=pt_path)
            model_path = pt_path

    application.state.model = YOLO(model_path, task="pose")
    application.state.executor = ThreadPoolExecutor(max_workers=2)
    log.info("model_loaded", path=model_path)

    # Verify DB is reachable
    async with db.engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    log.info("db_connected")

    # Connect to Redis
    application.state.redis = await create_redis_client()
    log.info("redis_connected")

    log.info("startup_complete")
    yield

    # --- SHUTDOWN ---
    application.state.executor.shutdown(wait=True)
    await db.engine.dispose()
    await application.state.redis.aclose()
    log.info("shutdown_complete")


app = FastAPI(
    title="PoseCoach API",
    description="Real-time AI gym exercise form correction",
    version="1.0.0",
    lifespan=lifespan,
)

# slowapi rate limiting — shared limiter (auth 10/min + chat 10/min, per IP)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
app.add_exception_handler(Exception, _unhandled_exception_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS — added first so it is outermost (handles OPTIONS preflight before anything else)
allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Custom middleware — applied inside CORS in this order: RequestId → Timing → SecurityHeaders
app.add_middleware(RequestIdMiddleware)
app.add_middleware(TimingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

def _verify_metrics_token(request: Request) -> None:
    """Authorize a request to /metrics — Prometheus scraper sends a Bearer token.

    The endpoint is only mounted when METRICS_TOKEN is set in the environment.
    A missing or wrong token returns 401 to avoid exposing internal counters.
    """
    expected = os.environ.get("METRICS_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=404)
    header = request.headers.get("Authorization", "")
    provided = header.removeprefix("Bearer ").strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid metrics token")


@app.get("/metrics", include_in_schema=False, dependencies=[Depends(_verify_metrics_token)])
async def metrics() -> PlainTextResponse:
    """Prometheus scrape endpoint — text/plain v0.0.4."""
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

    return PlainTextResponse(generate_latest(metrics_registry), media_type=CONTENT_TYPE_LATEST)

app.include_router(ws_router)
app.include_router(chat_router)
app.include_router(auth_router)
app.include_router(history_router)


@app.get("/health")
async def health_simple() -> dict[str, str]:
    """Shallow health check for load balancer pings."""
    return {"status": "ok"}


@app.get("/health/deep")
async def health_deep() -> dict[str, str]:
    """
    Deep health check — verifies all dependencies.
    Returns 503 (not 200) if any dependency is down.
    """
    status: dict[str, str] = {"postgres": "error", "redis": "error", "model": "error"}

    try:
        async with db.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        status["postgres"] = "ok"
    except Exception as e:
        logger.error("postgres_health_failed", error=str(e))

    try:
        pong = await app.state.redis.ping()
        if pong:
            status["redis"] = "ok"
    except Exception as e:
        logger.error("redis_health_failed", error=str(e))

    if hasattr(app.state, "model") and app.state.model is not None:
        status["model"] = "ok"

    if "error" in status.values():
        raise HTTPException(status_code=503, detail=status)

    return {"status": "ok", **status}
