import os
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.db_url import normalize_asyncpg_url


def _build_engine_config(raw_url: str, ssl_mode: str) -> tuple[str, dict[str, Any]]:
    """Resolve the URL + kwargs create_async_engine() should be built from.

    Pure — no env access, no I/O — so tests can exercise the exact same
    resolution app/db.py's module-level code runs at import time, for
    arbitrary inputs, without needing to reload this module (which would
    rebuild `Base` as a new class disconnected from the ORM mappings
    app/models.py already registered against the original one).

    Args:
        raw_url: The value of the POSTGRES_URL env var.
        ssl_mode: The value of the POSTGRES_SSL env var (possibly empty).

    Returns:
        A ``(clean_url, engine_kwargs)`` pair to splat into
        ``create_async_engine(clean_url, **engine_kwargs)``.

        normalize_asyncpg_url() passes non-Postgres URLs (sqlite, used by
        tests) through unchanged with empty connect_args, so this is a no-op
        for the sqlite branch — same URL, same absence of extra kwargs as
        before this function existed.

        For a Postgres URL, ``ssl_mode`` is a legacy override — the current
        Render deploy's mechanism, same precedence as alembic/env.py: if set,
        it always wins over whatever sslmode, if any, was embedded in the
        URL itself.
    """
    clean_url, url_connect_args = normalize_asyncpg_url(raw_url)
    is_sqlite = clean_url.startswith("sqlite")

    engine_kwargs: dict[str, Any] = {}
    if not is_sqlite:
        # pool_size/max_overflow not supported by SQLite (used in tests)
        engine_kwargs["pool_size"] = 10
        engine_kwargs["max_overflow"] = 20
        connect_args: dict[str, Any] = dict(url_connect_args)
        if ssl_mode:
            connect_args["ssl"] = ssl_mode
        if connect_args:
            engine_kwargs["connect_args"] = connect_args

    return clean_url, engine_kwargs


_db_url, _engine_kwargs = _build_engine_config(os.environ["POSTGRES_URL"], os.environ.get("POSTGRES_SSL", ""))
_is_sqlite = _db_url.startswith("sqlite")

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
