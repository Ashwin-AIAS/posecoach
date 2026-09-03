"""Tests for scripts/wait_for_db.py against an unreachable host.

Uses 127.0.0.1 on a port nothing listens on — "connection refused" comes
back almost instantly on loopback, so this stays well under the 10s budget
without needing a slow, black-holed address.
"""
from __future__ import annotations

import pytest

import scripts.wait_for_db as wait_for_db_mod
from scripts.wait_for_db import main, wait_for_db

UNREACHABLE_URL = "postgresql://user:pass@127.0.0.1:1/nope"


@pytest.fixture(autouse=True)
def _unreachable_db_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALEMBIC_DATABASE_URL", UNREACHABLE_URL)


def test_gives_up_after_timeout_with_multiple_attempts() -> None:
    result = wait_for_db(
        timeout_s=3.0,
        initial_interval_s=0.3,
        max_interval_s=0.5,
        connect_timeout_s=1.0,
    )
    assert result.success is False
    assert result.attempts > 1
    assert result.elapsed_s < 3.0 + 1.0  # deadline honored, plus one attempt's slack


def test_main_returns_nonzero_exit_code(monkeypatch: pytest.MonkeyPatch) -> None:
    # main() always uses the DB_WAIT_* env knobs + the module default connect
    # timeout, so keep both short via env vars to stay inside the test budget.
    monkeypatch.setenv("DB_WAIT_TIMEOUT", "3")
    monkeypatch.setenv("DB_WAIT_MAX_INTERVAL", "0.5")
    monkeypatch.setattr(wait_for_db_mod, "DEFAULT_CONNECT_TIMEOUT_S", 1.0)
    monkeypatch.setattr(wait_for_db_mod, "DEFAULT_INITIAL_INTERVAL_S", 0.3)

    exit_code = main()

    assert exit_code != 0


def test_missing_url_raises_instead_of_retrying(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALEMBIC_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    with pytest.raises(KeyError):
        wait_for_db(timeout_s=3.0)
