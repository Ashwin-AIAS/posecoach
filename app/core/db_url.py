"""Pure URL-normalization helpers for SQLAlchemy + asyncpg.

asyncpg's ``connect()`` does not accept libpq-only query parameters that
managed Postgres providers (Neon, Render, RDS) put on their connection
strings — ``sslmode`` and ``channel_binding`` are the two Neon puts on every
string it issues. SQLAlchemy forwards any query parameter it does not itself
recognize straight through as a DBAPI ``connect()`` keyword argument, so an
un-normalized URL raises ``TypeError: connect() got an unexpected keyword
argument 'sslmode'`` (or ``'channel_binding'``, or any other stray param) the
moment something opens a connection.

This module does no I/O — it only rewrites the URL string and derives the
``connect_args`` asyncpg actually understands. Callers (alembic/env.py,
scripts/wait_for_db.py, app/db.py) are responsible for using the result to
open a connection.
"""

from typing import Any
from urllib.parse import parse_qsl, urlsplit, urlunsplit

import structlog

logger = structlog.get_logger(__name__)

_POSTGRES_SCHEMES = frozenset({"postgres", "postgresql", "postgresql+asyncpg"})
_ASYNC_SCHEME = "postgresql+asyncpg"

# libpq sslmode -> asyncpg's `ssl` connect_arg.
#
# asyncpg's `ssl` kwarg is a bool or an `ssl.SSLContext`, never a mode string,
# so every "encrypt" mode below collapses to `ssl=True` (asyncpg then builds
# `ssl.create_default_context()`, which verifies the server certificate
# against the system trust store). That satisfies require/verify-ca/
# verify-full for providers with publicly-trusted certs — true of Neon and
# Render — but it does not reproduce libpq's weaker "require" semantics of
# encrypting without verifying, since asyncpg has no bool for that in-between
# state and this function does no I/O to build a custom SSLContext.
_SSLMODE_TO_SSL: dict[str, bool] = {
    "disable": False,
    "allow": False,
    "prefer": True,
    "require": True,
    "verify-ca": True,
    "verify-full": True,
}

# Query params asyncpg's connect() has no use for but libpq-speaking clients
# (psql, Neon's own connection-string generator) attach anyway. Dropped
# silently — unlike an unrecognized param, these are known-safe to discard.
_KNOWN_DROP_PARAMS = frozenset({"channel_binding"})


def normalize_asyncpg_url(url: str) -> tuple[str, dict[str, Any]]:
    """Rewrite a Postgres URL for SQLAlchemy's asyncpg dialect.

    Args:
        url: A SQLAlchemy connection URL, e.g. ``postgres://u:p@host/db``,
            ``postgresql://u:p@host/db?sslmode=require&channel_binding=require``,
            or a non-Postgres URL such as ``sqlite+aiosqlite:///:memory:``.

    Returns:
        A ``(clean_url, connect_args)`` pair.

        For a Postgres URL: ``clean_url`` has its scheme forced to
        ``postgresql+asyncpg`` and every query parameter removed —
        ``sslmode`` is consumed into ``connect_args``, ``channel_binding`` is
        dropped silently (libpq-only, asyncpg has no use for it), and any
        other, unrecognized parameter is dropped with a logged warning naming
        the key rather than passed through to asyncpg's ``connect()`` as an
        unexpected keyword argument. ``connect_args`` carries the
        asyncpg-native ``ssl`` kwarg derived from ``sslmode``, present only
        when the URL actually had one — callers should merge this into their
        own connect_args rather than overwrite them, so an explicit
        caller-side SSL override still wins.

        For any other URL (e.g. sqlite, used by the test suite): returned
        unchanged with empty connect_args.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()

    if scheme not in _POSTGRES_SCHEMES:
        return url, {}

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    connect_args: dict[str, Any] = {}
    for key, value in query_pairs:
        key_lower = key.lower()
        if key_lower == "sslmode":
            connect_args["ssl"] = _SSLMODE_TO_SSL.get(value.lower(), True)
        elif key_lower in _KNOWN_DROP_PARAMS:
            continue
        else:
            logger.warning("db_url_unknown_query_param_dropped", param=key)

    clean_url = urlunsplit((_ASYNC_SCHEME, parts.netloc, parts.path, "", parts.fragment))
    return clean_url, connect_args
