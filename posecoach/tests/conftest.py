"""Shared test fixtures — SQLite in-memory, never real Postgres."""
from __future__ import annotations

import os
import sys
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock

# ── Environment must be set before any app import ────────────────────────────
os.environ.setdefault("POSTGRES_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test_secret_at_least_32_chars_long_ok")
os.environ.setdefault("MODEL_PATH", "models/yolo_posecoach_v1.onnx")
os.environ.setdefault("GEMINI_API_KEY", "test_gemini_key")
os.environ.setdefault("OPENROUTER_API_KEY", "test_openrouter_key")
os.environ.setdefault("CHROMA_PATH", "data/chroma_test")
# Disable the shared slowapi limiter — its module-level counter would otherwise
# accumulate across the many auth/chat calls in the suite and trip 429s.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

# ── Stub heavy optional dependencies not installed in the test env ────────────
# These must be stubbed BEFORE any app.* import touches them.
for _mod in ("ultralytics",):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Chatbot deps — stub before any app.chatbot import
_chroma_mock = MagicMock()
_chroma_collection = MagicMock()
_chroma_collection.count.return_value = 0
_chroma_collection.query.return_value = {"documents": [[]]}
_chroma_mock.PersistentClient.return_value.get_or_create_collection.return_value = _chroma_collection
if "chromadb" not in sys.modules:
    sys.modules["chromadb"] = _chroma_mock

_st_mock = MagicMock()
_st_instance = MagicMock()
_st_instance.encode.return_value = [[0.1] * 384]
_st_mock.SentenceTransformer.return_value = _st_instance
if "sentence_transformers" not in sys.modules:
    sys.modules["sentence_transformers"] = _st_mock

_genai_mock = MagicMock()
if "google" not in sys.modules:
    sys.modules["google"] = MagicMock()
if "google.generativeai" not in sys.modules:
    sys.modules["google.generativeai"] = _genai_mock
    sys.modules["google"].generativeai = _genai_mock

_redis_mock = MagicMock()
_redis_mock.ping = AsyncMock(return_value=True)
_redis_mock.aclose = AsyncMock()
_redis_mock.get = AsyncMock(return_value=None)
_redis_mock.set = AsyncMock(return_value=True)
_redis_mock.delete = AsyncMock(return_value=1)
_redis_mock.expire = AsyncMock(return_value=True)
_redis_lib_mock = MagicMock()
_redis_lib_mock.from_url.return_value = _redis_mock
_redis_lib_mock.Redis = MagicMock
# `import redis.asyncio as redis` resolves via the parent's `.asyncio`
# attribute, not sys.modules['redis.asyncio'] — make the mock self-referential
# so both lookups land on the same object.
_redis_lib_mock.asyncio = _redis_lib_mock
# Force-replace — the real `redis` package may already be importable as a
# transitive dependency (e.g. via fakeredis), which would skip a guarded stub.
sys.modules["redis"] = _redis_lib_mock
sys.modules["redis.asyncio"] = _redis_lib_mock

# ── Fixtures ─────────────────────────────────────────────────────────────────
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="function")
async def test_db() -> AsyncGenerator[AsyncSession, None]:
    from app.db import Base  # lazy — avoids triggering engine at collection time

    engine = create_async_engine(
        TEST_DB_URL, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False
    )
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(test_db: AsyncSession) -> AsyncGenerator[object, None]:
    from httpx import ASGITransport, AsyncClient

    from app.db import get_db
    from app.main import app  # lazy

    app.dependency_overrides[get_db] = lambda: test_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
    app.dependency_overrides.clear()
