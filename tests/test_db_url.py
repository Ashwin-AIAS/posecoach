"""Unit tests for the pure Postgres-URL normalization helper.

No DB, no network — app/core/db_url.py does no I/O.
"""
from __future__ import annotations

import pytest

from app.core.db_url import normalize_asyncpg_url


@pytest.mark.parametrize(
    "scheme",
    ["postgres", "postgresql", "postgresql+asyncpg"],
)
def test_scheme_is_normalized_to_asyncpg(scheme: str) -> None:
    url = f"{scheme}://user:pass@host.example.com:5432/mydb"
    clean_url, connect_args = normalize_asyncpg_url(url)
    assert clean_url.startswith("postgresql+asyncpg://")
    assert "user:pass@host.example.com:5432/mydb" in clean_url
    assert connect_args == {}


def test_no_sslmode_param_leaves_connect_args_empty() -> None:
    clean_url, connect_args = normalize_asyncpg_url("postgresql://u:p@host/db")
    assert connect_args == {}
    assert "sslmode" not in clean_url


@pytest.mark.parametrize(
    ("sslmode", "expected_ssl"),
    [
        ("disable", False),
        ("allow", False),
        ("prefer", True),
        ("require", True),
        ("verify-ca", True),
        ("verify-full", True),
    ],
)
def test_sslmode_translated_to_asyncpg_ssl_kwarg(sslmode: str, expected_ssl: bool) -> None:
    url = f"postgresql://u:p@host/db?sslmode={sslmode}"
    clean_url, connect_args = normalize_asyncpg_url(url)
    assert connect_args == {"ssl": expected_ssl}
    assert "sslmode" not in clean_url


def test_sslmode_is_case_insensitive() -> None:
    _, connect_args = normalize_asyncpg_url("postgresql://u:p@host/db?sslmode=REQUIRE")
    assert connect_args == {"ssl": True}


def test_unknown_sslmode_value_defaults_to_encrypted() -> None:
    # Forward-compatible with a future libpq mode this table doesn't list yet
    # — fail toward encrypting, not toward silently connecting in the clear.
    _, connect_args = normalize_asyncpg_url("postgresql://u:p@host/db?sslmode=some-future-mode")
    assert connect_args == {"ssl": True}


def test_sslmode_stripped_but_other_query_params_kept() -> None:
    url = "postgresql://u:p@host/db?sslmode=require&application_name=posecoach"
    clean_url, connect_args = normalize_asyncpg_url(url)
    assert connect_args == {"ssl": True}
    assert "sslmode" not in clean_url
    assert "application_name=posecoach" in clean_url


def test_legacy_postgres_scheme_with_sslmode() -> None:
    clean_url, connect_args = normalize_asyncpg_url("postgres://u:p@host/db?sslmode=require")
    assert clean_url.startswith("postgresql+asyncpg://")
    assert connect_args == {"ssl": True}


def test_non_postgres_url_passes_through_unchanged() -> None:
    url = "sqlite+aiosqlite:///:memory:"
    clean_url, connect_args = normalize_asyncpg_url(url)
    assert clean_url == url
    assert connect_args == {}


def test_credentials_are_not_re_encoded_or_dropped() -> None:
    # A password with characters that would be mangled by a naive rebuild.
    url = "postgresql://user:p%40ss@host/db?sslmode=require"
    clean_url, _ = normalize_asyncpg_url(url)
    assert "user:p%40ss@host" in clean_url
