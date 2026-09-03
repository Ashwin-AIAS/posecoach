"""Tests that app/db.py runs POSTGRES_URL through normalize_asyncpg_url()
before building its engine — the actual app boot path, not just alembic/
env.py or scripts/wait_for_db.py.

app/db.py's module-level code (which builds `engine` at import time) is not
safe to re-exercise via importlib.reload: reloading it would rebuild `Base`
as a brand-new class, disconnected from the ORM mappings app/models.py
already registered against the original one, breaking every other test that
does `from app.db import Base` afterward. So app/db.py factors the URL/kwarg
resolution out into the pure `_build_engine_config()` helper, and these
tests call that directly with arbitrary POSTGRES_URL/POSTGRES_SSL-shaped
inputs — same resolution the module runs at import time, no reload needed.
"""
from __future__ import annotations

from app.db import _build_engine_config, engine

NEON_SHAPED_URL = (
    "postgresql://u:p@ep-cool-shape-123456-pooler.us-east-2.aws.neon.tech/"
    "neondb?sslmode=require&channel_binding=require"
)


def test_engine_built_from_normalized_neon_url() -> None:
    clean_url, engine_kwargs = _build_engine_config(NEON_SHAPED_URL, "")

    assert clean_url == (
        "postgresql+asyncpg://u:p@ep-cool-shape-123456-pooler.us-east-2.aws.neon.tech/neondb"
    )
    assert "?" not in clean_url
    assert engine_kwargs["connect_args"] == {"ssl": True}


def test_postgres_ssl_env_wins_over_url_sslmode() -> None:
    _, engine_kwargs = _build_engine_config(NEON_SHAPED_URL, "verify-full")

    assert engine_kwargs["connect_args"] == {"ssl": "verify-full"}


def test_sqlite_branch_is_unaffected_by_normalization() -> None:
    sqlite_url = "sqlite+aiosqlite:///:memory:"
    clean_url, engine_kwargs = _build_engine_config(sqlite_url, "")

    assert clean_url == sqlite_url
    assert engine_kwargs == {}


def test_module_level_engine_is_built_via_build_engine_config() -> None:
    # The test suite's own POSTGRES_URL (conftest.py) is sqlite — confirms
    # the real module-level `engine`, not just the helper in isolation, was
    # constructed through this same resolution path.
    clean_url, engine_kwargs = _build_engine_config("sqlite+aiosqlite:///:memory:", "")
    assert str(engine.url) == clean_url
    assert engine_kwargs == {}
