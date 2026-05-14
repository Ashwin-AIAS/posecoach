"""Shared test fixtures.

Prerequisites:
    createdb -U posecoach posecoach_test
    # or set TEST_DATABASE_URL env var before running pytest
"""
import os
import subprocess
from collections.abc import AsyncGenerator, Generator

# Must be set before any app import — app/db.py creates the async engine at
# module level by reading POSTGRES_URL, so patching after import is too late.
_TEST_DB_URL: str = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://posecoach:dev_password@localhost:5432/posecoach_test",
)
os.environ["POSTGRES_URL"] = _TEST_DB_URL

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


@pytest.fixture(scope="session")
def apply_migrations() -> Generator[None, None, None]:
    """Run `alembic upgrade head` against the test DB; tear down after session."""
    env = {**os.environ, "POSTGRES_URL": _TEST_DB_URL}
    subprocess.run(["alembic", "upgrade", "head"], env=env, check=True)
    yield
    subprocess.run(["alembic", "downgrade", "base"], env=env, check=True)


@pytest.fixture(scope="session")
def test_engine(apply_migrations: None) -> AsyncEngine:
    """Async engine pointed at the test DB (migrations already applied)."""
    return create_async_engine(_TEST_DB_URL, echo=False)


@pytest_asyncio.fixture
async def db_session(test_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """Per-test async session; rolled back after each test for full isolation."""
    factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()
