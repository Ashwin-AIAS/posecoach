"""Pure URL-normalization helpers for SQLAlchemy + asyncpg.

asyncpg's ``connect()`` does not accept the libpq ``sslmode`` query parameter
that managed Postgres providers (Neon, Render, RDS) put on their connection
strings. SQLAlchemy forwards any query parameter it does not itself recognize
straight through as a DBAPI ``connect()`` keyword argument, so an
un-normalized URL raises ``TypeError: connect() got an unexpected keyword
argument 'sslmode'`` the moment something opens a connection.

This module does no I/O — it only rewrites the URL string and derives the
``connect_args`` asyncpg actually understands. Callers (alembic/env.py,
scripts/wait_for_db.py) are responsible for using the result to open a
connection.
"""

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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


def normalize_asyncpg_url(url: str) -> tuple[str, dict[str, Any]]:
    """Rewrite a Postgres URL for SQLAlchemy's asyncpg dialect.

    Args:
        url: A SQLAlchemy connection URL, e.g. ``postgres://u:p@host/db``,
            ``postgresql://u:p@host/db?sslmode=require``, or a non-Postgres
            URL such as ``sqlite+aiosqlite:///:memory:``.

    Returns:
        A ``(clean_url, connect_args)`` pair.

        For a Postgres URL: ``clean_url`` has its scheme forced to
        ``postgresql+asyncpg`` and any ``sslmode`` query parameter removed
        (asyncpg rejects it as an unknown connect() kwarg); ``connect_args``
        carries the asyncpg-native ``ssl`` kwarg derived from that
        ``sslmode``, present only when the URL actually had one — callers
        should merge this into their own connect_args rather than overwrite
        them, so an explicit caller-side SSL override still wins.

        For any other URL (e.g. sqlite, used by the test suite): returned
        unchanged with empty connect_args.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()

    if scheme not in _POSTGRES_SCHEMES:
        return url, {}

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    remaining_pairs: list[tuple[str, str]] = []
    connect_args: dict[str, Any] = {}
    for key, value in query_pairs:
        if key.lower() == "sslmode":
            connect_args["ssl"] = _SSLMODE_TO_SSL.get(value.lower(), True)
        else:
            remaining_pairs.append((key, value))

    clean_url = urlunsplit(
        (_ASYNC_SCHEME, parts.netloc, parts.path, urlencode(remaining_pairs), parts.fragment)
    )
    return clean_url, connect_args
