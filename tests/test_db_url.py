"""Unit tests for the pure Postgres-URL normalization helper.

No DB, no network — app/core/db_url.py does no I/O.
"""
from __future__ import annotations

import pytest

import app.core.db_url as db_url_module
from app.core.db_url import normalize_asyncpg_url

NEON_POOLED_URL = (
    "postgresql://u:p@ep-cool-shape-123456-pooler.us-east-2.aws.neon.tech/"
    "neondb?sslmode=require&channel_binding=require"
)


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


def test_channel_binding_is_stripped() -> None:
    url = "postgresql://u:p@host/db?sslmode=require&channel_binding=require"
    clean_url, connect_args = normalize_asyncpg_url(url)
    assert connect_args == {"ssl": True}
    assert "channel_binding" not in clean_url
    assert "sslmode" not in clean_url


def test_full_neon_shaped_url_has_no_query_params_left_and_correct_ssl() -> None:
    clean_url, connect_args = normalize_asyncpg_url(NEON_POOLED_URL)
    assert clean_url.startswith("postgresql+asyncpg://")
    assert "?" not in clean_url
    assert connect_args == {"ssl": True}


def test_unknown_query_param_is_dropped_and_warned(monkeypatch: pytest.MonkeyPatch) -> None:
    # Assert against the module's own logger call rather than caplog: structlog
    # only routes through stdlib `logging` (which caplog hooks) once
    # `setup_logging()` has run, and this unit test must not depend on that.
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        db_url_module.logger,
        "warning",
        lambda event, **kw: calls.append((event, kw)),
    )

    url = "postgresql://u:p@host/db?sslmode=require&application_name=posecoach"
    clean_url, connect_args = normalize_asyncpg_url(url)

    assert connect_args == {"ssl": True}
    assert "application_name" not in clean_url
    assert "sslmode" not in clean_url
    assert "?" not in clean_url
    assert calls == [("db_url_unknown_query_param_dropped", {"param": "application_name"})]


def test_known_drop_param_alone_does_not_warn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object]]] = []
    monkeypatch.setattr(
        db_url_module.logger,
        "warning",
        lambda event, **kw: calls.append((event, kw)),
    )

    clean_url, connect_args = normalize_asyncpg_url("postgresql://u:p@host/db?channel_binding=require")

    assert connect_args == {}
    assert "channel_binding" not in clean_url
    assert calls == []


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
