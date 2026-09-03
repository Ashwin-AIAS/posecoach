"""
Alembic environment — configured for async SQLAlchemy.
DO NOT change to sync pattern — asyncpg requires async engine.
"""
import asyncio
import os
from logging.config import fileConfig
from typing import Any

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import all models so Alembic can detect schema changes
from app.core.db_url import normalize_asyncpg_url
from app.db import Base
from app.models import User, WorkoutSession  # noqa: F401 — required for autogenerate

# Alembic config object
config = context.config

# Direct (non-pooled) endpoint for migrations — a pooler in front of a
# scale-to-zero DB (Neon) can itself be slow/unready during a cold start.
# Falls back to POSTGRES_URL (the app's pooled var) so local dev, where only
# one DB URL is ever set, is unaffected.
config.set_main_option(
    "sqlalchemy.url", os.environ.get("ALEMBIC_DATABASE_URL") or os.environ["POSTGRES_URL"]
)

# Python logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Model metadata for --autogenerate
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (offline mode)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations using the async engine — required for asyncpg."""
    raw_url = config.get_main_option("sqlalchemy.url") or ""
    clean_url, url_connect_args = normalize_asyncpg_url(raw_url)

    # Legacy override: an explicit POSTGRES_SSL env var (the current Render
    # deploy's mechanism, same as app/db.py) always wins over whatever
    # sslmode — if any — was embedded in the URL itself.
    ssl_mode = os.environ.get("POSTGRES_SSL", "")
    if ssl_mode and not raw_url.startswith("sqlite"):
        connect_args: dict[str, Any] = {"ssl": ssl_mode}
    else:
        connect_args = url_connect_args

    section = dict(config.get_section(config.config_ini_section, {}))
    section["sqlalchemy.url"] = clean_url
    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
