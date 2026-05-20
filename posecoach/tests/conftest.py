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

# ── Stub heavy optional dependencies not installed in the test env ────────────
# These must be stubbed BEFORE any app.* import touches them.
for _mod in ("ultralytics", "prometheus_client"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

_redis_mock = MagicMock()
_redis_mock.ping = AsyncMock(return_value=True)
_redis_mock.aclose = AsyncMock()
for _mod in ("redis", "redis.asyncio"):
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

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
