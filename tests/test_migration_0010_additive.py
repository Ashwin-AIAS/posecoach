"""P34.2 additivity guard — migration 0010 is create-only and every pre-existing
table (the frozen CV ``workout_sessions`` and the P27 nutrition tables) is left
intact.

This locks the P34.2 contract: the calorie-budget schema may only *add* a table.
If a future edit makes 0010 alter/drop an existing column or detaches it from
the 0009 chain, these tests fail loudly.
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
    / "20260727_1200_0010_nutrition_goal.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0010", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_0010_chains_from_0009() -> None:
    m = _load_migration()
    assert m.revision == "0010"
    assert m.down_revision == "0009"


def test_migration_0010_upgrade_is_create_only() -> None:
    src = inspect.getsource(_load_migration().upgrade)
    assert "op.create_table(" in src
    for forbidden in ("op.drop_table(", "op.drop_column(", "op.alter_column(", "op.add_column("):
        assert forbidden not in src, f"non-additive op in upgrade(): {forbidden}"


def test_migration_0010_downgrade_drops_only_the_new_table() -> None:
    src = inspect.getsource(_load_migration().downgrade)
    assert 'op.drop_table("nutrition_goals")' in src
    assert src.count("op.drop_table(") == 1


def test_nutrition_goals_table_added_and_existing_tables_intact() -> None:
    tables = set(Base.metadata.tables)
    assert "nutrition_goals" in tables
    # The P27 diary tables and the frozen CV record table are untouched.
    assert {"food_items", "food_log_entries", "workout_sessions"} <= tables
    goal = Base.metadata.tables["nutrition_goals"]
    assert {
        "id",
        "user_id",
        "kcal_target",
        "protein_target_g",
        "carbs_target_g",
        "fat_target_g",
        "updated_at",
    } <= set(goal.columns.keys())
    # One budget per user — the PUT upsert depends on it.
    assert goal.columns["user_id"].unique is True
    ws = Base.metadata.tables["workout_sessions"]
    assert {"id", "user_id", "exercise", "rep_count", "avg_form_score"} <= set(ws.columns.keys())
