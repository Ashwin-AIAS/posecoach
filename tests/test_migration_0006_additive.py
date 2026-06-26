"""P24 additivity guard — migration 0006 is create-only and the existing schema
(the frozen CV ``workout_sessions`` table) is left intact.

This locks the P24 contract: the workout-logger schema may only *add* tables. If a
future edit makes 0006 alter/drop an existing column or detaches it from the 0005
chain, these tests fail loudly.
"""
from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path
from types import ModuleType

import app.models  # noqa: F401 — registers all ORM tables on Base.metadata
from app.db import Base

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260626_1200_0006_workout_logger.py"
)

NEW_TABLES = {
    "exercises",
    "workout_logs",
    "logged_exercises",
    "logged_sets",
    "routines",
    "routine_exercises",
}


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0006", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0006_chains_from_0005() -> None:
    m = _load_migration()
    assert m.revision == "0006"
    assert m.down_revision == "0005"


def test_migration_0006_upgrade_is_create_only() -> None:
    src = inspect.getsource(_load_migration().upgrade)
    assert "op.create_table(" in src
    for forbidden in ("op.drop_table(", "op.drop_column(", "op.alter_column(", "op.add_column("):
        assert forbidden not in src, f"non-additive op in upgrade(): {forbidden}"


def test_new_tables_present_and_workout_sessions_intact() -> None:
    tables = set(Base.metadata.tables)
    assert NEW_TABLES <= tables
    # The frozen CV record table keeps its core columns — unchanged by P24.
    ws = Base.metadata.tables["workout_sessions"]
    assert {"id", "user_id", "exercise", "rep_count", "avg_form_score"} <= set(ws.columns.keys())
