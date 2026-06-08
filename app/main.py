import asyncio
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
from app.inference.onnx_session import OnnxPoseSession
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


async def _ensure_rag_index(application: FastAPI) -> None:
    """Populate the RAG vector index at startup if it is empty.

    Moved out of the Docker build (was a fragile network dependency at build
    time). Runs in the executor so it never blocks the event loop, and is
    scheduled as a background task so startup/health checks are not delayed.
    ``retrieve()`` returns no chunks while the index is empty, so the chatbot
    degrades gracefully to the web/general-knowledge fallback until it is ready.
    """
    log = structlog.get_logger(__name__)
    loop = asyncio.get_running_loop()

    def _build() -> int:
        from app.chatbot.ingest import DEFAULT_SOURCE, ingest
        from app.chatbot.rag import _get_collection

        if _get_collection().count() > 0:
            return -1  # already populated
        return ingest(DEFAULT_SOURCE, reset=False)

    try:
        count = await loop.run_in_executor(application.state.executor, _build)
        if count < 0:
            log.info("rag_index_present")
        else:
            log.info("rag_index_built", chunks=count)
    except Exception as exc:  # noqa: BLE001 — never crash startup over the KB
        log.error("rag_index_build_failed", error=repr(exc))


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging()

    log = structlog.get_logger(__name__)
    log.info("startup_begin")

    # Load the pose model once — stored in app.state for all requests.
    # .strip() guards against a stray leading/trailing space in the env var; the
    # onnxruntime loader would otherwise treat it as part of the path (NO_SUCHFILE).
    model_path = os.environ["MODEL_PATH"].strip()

    if model_path.endswith(".onnx"):
        # Direct ONNX Runtime path with its own keypoint decode — bypasses the
        # Ultralytics 8.4.x InferenceSession bug (which the old code worked around
        # by silently loading the slow .pt) and is far faster on CPU.
        onnx_threads = int(os.environ.get("ONNX_INTRA_OP_THREADS", "2"))
        application.state.model = OnnxPoseSession(model_path, intra_op_threads=onnx_threads)
    else:
        # PyTorch weights — dev/local convenience (env-selectable via MODEL_PATH).
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

    # Build the RAG index in the background (non-blocking) if it is empty.
    application.state.rag_task = asyncio.create_task(_ensure_rag_index(application))

    log.info("startup_complete")
    yield

    # --- SHUTDOWN ---
    rag_task = getattr(application.state, "rag_task", None)
    if rag_task is not None and not rag_task.done():
        rag_task.cancel()
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
