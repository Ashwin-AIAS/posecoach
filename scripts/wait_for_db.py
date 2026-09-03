"""Boot-resilience gate — poll the database until it accepts a connection.

Runs as a standalone step in ``docker-entrypoint.sh``, before ``alembic
upgrade head``. The target DB is Neon (serverless, scale-to-zero), so the
*first* connection after any idle period is a guaranteed cold start —
without this, a single dropped/refused connection at boot is fatal: the old
``CMD ["sh", "-c", "alembic upgrade head && uvicorn ..."]`` turned one
transient asyncpg blip into 19 days of Space downtime (2026-08-13).

Uses the Alembic (direct, non-pooled) URL — the same endpoint alembic/env.py
migrates against — since a connection pooler in front of a scale-to-zero DB
can itself be slow or unready during a cold start.

Exit codes: 0 on success, 1 on timeout, 1 (uncaught) if neither
ALEMBIC_DATABASE_URL nor POSTGRES_URL is set — that is a config error, not a
transient DB state, and must fail loudly rather than retry.
"""

import asyncio
import os
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import asyncpg
import structlog

from app.core.db_url import normalize_asyncpg_url

logger = structlog.get_logger(__name__)

DEFAULT_TIMEOUT_S = 60.0
DEFAULT_INITIAL_INTERVAL_S = 2.0
DEFAULT_MAX_INTERVAL_S = 8.0
DEFAULT_CONNECT_TIMEOUT_S = 5.0


@dataclass(frozen=True)
class WaitResult:
    """Outcome of a wait_for_db() run — plain data, easy to assert on in tests."""

    success: bool
    attempts: int
    elapsed_s: float


def _target_url() -> str:
    url = os.environ.get("ALEMBIC_DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise KeyError("Neither ALEMBIC_DATABASE_URL nor POSTGRES_URL is set")
    return url


def _redact(url: str) -> str:
    """Host + dbname only — never the DSN, credentials, or query string."""
    parts = urlsplit(url)
    host = parts.hostname or "?"
    port = f":{parts.port}" if parts.port else ""
    dbname = parts.path.lstrip("/") or "?"
    return f"{host}{port}/{dbname}"


async def _try_connect(dsn: str, connect_args: dict[str, Any], connect_timeout_s: float) -> None:
    # asyncpg.connect() wants a plain "postgresql://" DSN, not SQLAlchemy's
    # dialect-qualified "+asyncpg" scheme.
    plain_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = await asyncpg.connect(plain_dsn, timeout=connect_timeout_s, **connect_args)
    await conn.close()


def wait_for_db(
    *,
    timeout_s: float | None = None,
    initial_interval_s: float | None = None,
    max_interval_s: float | None = None,
    connect_timeout_s: float | None = None,
) -> WaitResult:
    """Poll the DB until a connection succeeds or the deadline passes.

    Never raises for a connection failure — every attempt's exception is
    logged and swallowed so polling continues. Only a missing/malformed URL
    (a config error, not a transient DB state) raises, out of `_target_url()`.

    Every default below is resolved inside the function body (not bound as a
    literal parameter default) so tests can monkeypatch the module-level
    DEFAULT_* constants and env vars and have it actually take effect.
    """
    timeout_s = timeout_s if timeout_s is not None else float(
        os.environ.get("DB_WAIT_TIMEOUT", DEFAULT_TIMEOUT_S)
    )
    max_interval_s = max_interval_s if max_interval_s is not None else float(
        os.environ.get("DB_WAIT_MAX_INTERVAL", DEFAULT_MAX_INTERVAL_S)
    )
    initial_interval_s = (
        initial_interval_s if initial_interval_s is not None else DEFAULT_INITIAL_INTERVAL_S
    )
    connect_timeout_s = (
        connect_timeout_s if connect_timeout_s is not None else DEFAULT_CONNECT_TIMEOUT_S
    )

    raw_url = _target_url()
    clean_url, connect_args = normalize_asyncpg_url(raw_url)
    target = _redact(clean_url)

    interval_s = initial_interval_s
    start = time.monotonic()
    attempt = 0
    while True:
        attempt += 1
        try:
            asyncio.run(_try_connect(clean_url, connect_args, connect_timeout_s))
            elapsed_s = time.monotonic() - start
            logger.info("db_wait_ok", attempt=attempt, elapsed_s=round(elapsed_s, 1), target=target)
            return WaitResult(success=True, attempts=attempt, elapsed_s=elapsed_s)
        except Exception as exc:  # noqa: BLE001 — any connect failure is retryable here
            elapsed_s = time.monotonic() - start
            logger.warning(
                "db_wait_retry",
                attempt=attempt,
                elapsed_s=round(elapsed_s, 1),
                target=target,
                error=type(exc).__name__,
            )

        elapsed_s = time.monotonic() - start
        if elapsed_s + interval_s >= timeout_s:
            logger.error(
                "db_wait_timeout", attempts=attempt, elapsed_s=round(elapsed_s, 1), target=target
            )
            return WaitResult(success=False, attempts=attempt, elapsed_s=elapsed_s)

        time.sleep(interval_s)
        interval_s = min(interval_s * 2, max_interval_s)


def main() -> int:
    result = wait_for_db()
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
