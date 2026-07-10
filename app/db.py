import os
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_db_url = os.environ["POSTGRES_URL"]
_is_sqlite = _db_url.startswith("sqlite")

# Managed Postgres providers reject non-TLS connections, but SQLAlchemy hands
# asyncpg discrete host/port params, so sslmode in the URL is not honored —
# TLS must be forced via connect_args. asyncpg accepts libpq sslmode strings
# ('require', 'verify-full', ...); unset keeps today's behavior for local dev.
_ssl_mode = os.environ.get("POSTGRES_SSL", "")

_engine_kwargs: dict[str, Any] = {}
if not _is_sqlite:
    # pool_size/max_overflow not supported by SQLite (used in tests)
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20
    if _ssl_mode:
        _engine_kwargs["connect_args"] = {"ssl": _ssl_mode}

engine = create_async_engine(
    _db_url,
    pool_pre_ping=not _is_sqlite,
    echo=False,
    **_engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — injects an async DB session into route handlers."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
