"""Unit tests for app/nutrition/service.py (P27) — direct calls, respx OFF.

The API tests exercise these paths end-to-end; these direct tests pin the
service contract (cache-first, miss handling, the unique-barcode race) and the
pure snapshot math.
"""
from __future__ import annotations

import httpx
import respx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodItem
from app.nutrition.off_client import OFF_BASE_URL
from app.nutrition.service import (
    get_or_fetch_food,
    get_visible_food,
    search_visible_foods,
    snapshot_macros,
)

BARCODE = "3017620422003"


def _food(**overrides: object) -> FoodItem:
    defaults: dict[str, object] = {
        "barcode": BARCODE,
        "name": "Nutella",
        "kcal_100g": 539.0,
        "protein_100g": 6.3,
        "carbs_100g": 57.5,
        "fat_100g": 30.9,
        "source": "off",
    }
    defaults.update(overrides)
    return FoodItem(**defaults)


def _off_payload() -> dict[str, object]:
    return {
        "code": BARCODE,
        "status": 1,
        "product": {
            "product_name": "Nutella",
            "brands": "Ferrero",
            "serving_quantity": 15,
            "nutriments": {
                "energy-kcal_100g": 539,
                "proteins_100g": 6.3,
                "carbohydrates_100g": 57.5,
                "fat_100g": 30.9,
            },
        },
    }


# ── snapshot_macros (pure) ────────────────────────────────────────────────────


def test_snapshot_macros_scales_and_rounds() -> None:
    food = _food()
    assert snapshot_macros(food, 30.0) == (161.7, 1.89, 17.25, 9.27)
    assert snapshot_macros(food, 100.0) == (539.0, 6.3, 57.5, 30.9)


def test_snapshot_macros_is_deterministic() -> None:
    food = _food()
    assert snapshot_macros(food, 42.0) == snapshot_macros(food, 42.0)


# ── get_or_fetch_food ─────────────────────────────────────────────────────────


async def test_cached_row_short_circuits(test_db: AsyncSession) -> None:
    row = _food()
    test_db.add(row)
    await test_db.commit()

    # No respx mock active — a network attempt would raise.
    found = await get_or_fetch_food(test_db, BARCODE)
    assert found is not None
    assert found.id == row.id


@respx.mock
async def test_miss_fetches_and_caches(test_db: AsyncSession) -> None:
    route = respx.get(f"{OFF_BASE_URL}/{BARCODE}").mock(
        return_value=httpx.Response(200, json=_off_payload())
    )

    food = await get_or_fetch_food(test_db, BARCODE)
    assert food is not None
    assert food.source == "off"
    assert food.kcal_100g == 539.0
    assert route.call_count == 1

    again = await get_or_fetch_food(test_db, BARCODE)
    assert again is not None
    assert again.id == food.id
    assert route.call_count == 1  # served from the DB the second time


@respx.mock
async def test_off_miss_returns_none_and_caches_nothing(test_db: AsyncSession) -> None:
    respx.get(f"{OFF_BASE_URL}/{BARCODE}").mock(
        return_value=httpx.Response(404, json={"status": 0})
    )
    assert await get_or_fetch_food(test_db, BARCODE) is None
    count = (
        await test_db.execute(select(func.count()).select_from(FoodItem))
    ).scalar_one()
    assert count == 0


@respx.mock
async def test_unique_barcode_race_returns_winner_row(test_db: AsyncSession) -> None:
    respx.get(f"{OFF_BASE_URL}/{BARCODE}").mock(
        return_value=httpx.Response(200, json=_off_payload())
    )
    # Simulate the race: a concurrent request commits the same barcode between
    # this request's cache check and its INSERT, so the flush hits the unique
    # index. The loser must roll back and return the winner's row, not error.
    from sqlalchemy.exc import IntegrityError

    original_flush = test_db.flush
    original_rollback = test_db.rollback
    raced = False

    async def flush_conflicts_once() -> None:
        nonlocal raced
        if not raced:
            raced = True
            raise IntegrityError("INSERT INTO food_items", {}, Exception("UNIQUE barcode"))
        await original_flush()

    async def rollback_then_winner_appears() -> None:
        # The real rollback discards the loser's pending insert; the winner's
        # committed row (from the "other request") is then visible.
        await original_rollback()
        test_db.add(_food(name="Winner row"))
        await test_db.commit()

    test_db.flush = flush_conflicts_once  # type: ignore[method-assign]
    test_db.rollback = rollback_then_winner_appears  # type: ignore[method-assign]
    try:
        food = await get_or_fetch_food(test_db, BARCODE)
    finally:
        test_db.flush = original_flush  # type: ignore[method-assign]
        test_db.rollback = original_rollback  # type: ignore[method-assign]

    assert food is not None
    assert food.name == "Winner row"
    count = (
        await test_db.execute(select(func.count()).select_from(FoodItem))
    ).scalar_one()
    assert count == 1


# ── visibility helpers ────────────────────────────────────────────────────────


async def test_visible_food_rules(test_db: AsyncSession) -> None:
    off_row = _food()
    mine = FoodItem(name="My dal", kcal_100g=120.0, source="manual", created_by="user-a")
    foreign = FoodItem(name="Their dal", kcal_100g=120.0, source="manual", created_by="user-b")
    test_db.add_all([off_row, mine, foreign])
    await test_db.commit()

    assert await get_visible_food(test_db, user_id="user-a", food_id=off_row.id) is not None
    assert await get_visible_food(test_db, user_id="user-a", food_id=mine.id) is not None
    assert await get_visible_food(test_db, user_id="user-a", food_id=foreign.id) is None


async def test_search_visible_foods_scopes_and_matches(test_db: AsyncSession) -> None:
    test_db.add_all(
        [
            _food(),
            FoodItem(name="My dal", kcal_100g=120.0, source="manual", created_by="user-a"),
            FoodItem(name="Their dal", kcal_100g=120.0, source="manual", created_by="user-b"),
        ]
    )
    await test_db.commit()

    dal_hits = await search_visible_foods(test_db, user_id="user-a", query="dal")
    assert [f.name for f in dal_hits] == ["My dal"]

    brand_hits = await search_visible_foods(test_db, user_id="user-a", query="nutella")
    assert [f.name for f in brand_hits] == ["Nutella"]
