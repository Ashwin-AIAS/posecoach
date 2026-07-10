"""Nutrition API tests (P27) — SQLite in-memory, respx-mocked OFF, IDOR.

Covers: auth required, the cache-first barcode lookup (second scan makes zero
OFF calls), 404/422/503 paths, manual-food visibility (a foreign manual food
behaves like a missing one), server-side snapshot math, daily totals, PATCH
recompute, and diary IDOR in both directions.
"""
from __future__ import annotations

import httpx
import pytest_asyncio
import respx
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodItem
from app.nutrition.off_client import OFF_BASE_URL

NUTRITION = "/api/v1/nutrition"
BARCODE = "3017620422003"


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _off_payload() -> dict[str, object]:
    return {
        "code": BARCODE,
        "status": 1,
        "product": {
            "product_name": "Nutella",
            "brands": "Ferrero",
            "serving_size": "1 tbsp (15 g)",
            "serving_quantity": 15,
            "nutriments": {
                "energy-kcal_100g": 539,
                "proteins_100g": 6.3,
                "carbohydrates_100g": 57.5,
                "fat_100g": 30.9,
            },
        },
    }


@pytest_asyncio.fixture
async def cached_food(test_db: AsyncSession) -> FoodItem:
    """A pre-cached OFF row — lookups against it must never hit the network."""
    food = FoodItem(
        barcode=BARCODE,
        name="Nutella",
        brand="Ferrero",
        serving_size_g=15.0,
        serving_label="1 tbsp (15 g)",
        kcal_100g=539.0,
        protein_100g=6.3,
        carbs_100g=57.5,
        fat_100g=30.9,
        source="off",
    )
    test_db.add(food)
    await test_db.commit()
    return food


# ── Auth ──────────────────────────────────────────────────────────────────────


async def test_lookup_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(f"{NUTRITION}/products/{BARCODE}")
    assert resp.status_code == 401


async def test_log_requires_auth(client: AsyncClient) -> None:
    resp = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-10"})
    assert resp.status_code == 401


# ── Barcode lookup ────────────────────────────────────────────────────────────


@respx.mock
async def test_lookup_fetches_once_then_serves_from_cache(client: AsyncClient) -> None:
    await _register(client, "scanner@x.com")
    route = respx.get(f"{OFF_BASE_URL}/{BARCODE}").mock(
        return_value=httpx.Response(200, json=_off_payload())
    )

    first = await client.get(f"{NUTRITION}/products/{BARCODE}")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["name"] == "Nutella"
    assert body["kcal_100g"] == 539.0
    assert body["source"] == "off"
    assert route.call_count == 1

    second = await client.get(f"{NUTRITION}/products/{BARCODE}")
    assert second.status_code == 200
    assert second.json()["id"] == body["id"]
    assert route.call_count == 1  # cache hit — zero further OFF calls


@respx.mock
async def test_lookup_unknown_barcode_returns_404(client: AsyncClient) -> None:
    await _register(client, "unknown@x.com")
    respx.get(f"{OFF_BASE_URL}/4000000000000").mock(
        return_value=httpx.Response(404, json={"status": 0})
    )
    resp = await client.get(f"{NUTRITION}/products/4000000000000")
    assert resp.status_code == 404


@respx.mock
async def test_lookup_off_down_returns_503(client: AsyncClient) -> None:
    await _register(client, "offline@x.com")
    respx.get(f"{OFF_BASE_URL}/4000000000000").mock(return_value=httpx.Response(500))
    resp = await client.get(f"{NUTRITION}/products/4000000000000")
    assert resp.status_code == 503


async def test_lookup_malformed_barcode_returns_422(client: AsyncClient) -> None:
    await _register(client, "malformed@x.com")
    for bad in ("abc123", "12345", "123456789012345"):
        resp = await client.get(f"{NUTRITION}/products/{bad}")
        assert resp.status_code == 422, bad


async def test_lookup_cached_row_needs_no_network(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    # No respx mock active — a network attempt would raise, so a 200 proves
    # the row came from the DB cache.
    await _register(client, "cachehit@x.com")
    resp = await client.get(f"{NUTRITION}/products/{BARCODE}")
    assert resp.status_code == 200
    assert resp.json()["id"] == cached_food.id


# ── Manual foods + visibility ────────────────────────────────────────────────


async def test_manual_food_create_and_search_scoped_to_creator(client: AsyncClient) -> None:
    await _register(client, "cook-a@x.com")
    created = await client.post(
        f"{NUTRITION}/foods",
        json={"name": "Mom's dal", "kcal_100g": 120.0, "protein_100g": 7.0},
    )
    assert created.status_code == 201, created.text
    food = created.json()
    assert food["source"] == "manual"

    mine = await client.get(f"{NUTRITION}/foods/search", params={"q": "dal"})
    assert [f["id"] for f in mine.json()] == [food["id"]]

    # Registering user B switches the cookie identity — B must not see A's food.
    await _register(client, "cook-b@x.com")
    theirs = await client.get(f"{NUTRITION}/foods/search", params={"q": "dal"})
    assert theirs.json() == []

    # …and B cannot log it either (foreign manual food == missing).
    resp = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": food["id"],
            "logged_date": "2026-07-10",
            "meal": "lunch",
            "amount_g": 200.0,
        },
    )
    assert resp.status_code == 404


async def test_search_finds_off_rows_for_everyone(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "searcher@x.com")
    resp = await client.get(f"{NUTRITION}/foods/search", params={"q": "nutel"})
    assert resp.status_code == 200
    assert [f["id"] for f in resp.json()] == [cached_food.id]


# ── Diary ─────────────────────────────────────────────────────────────────────


async def test_log_entry_snapshots_macros_server_side(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "logger@x.com")
    resp = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-10",
            "meal": "breakfast",
            "amount_g": 30.0,
        },
    )
    assert resp.status_code == 201, resp.text
    entry = resp.json()
    # 30 g of a 539 kcal/100 g food — server math, client sent no macros.
    assert entry["kcal"] == 161.7
    assert entry["protein_g"] == 1.89
    assert entry["carbs_g"] == 17.25
    assert entry["fat_g"] == 9.27
    assert entry["food"]["name"] == "Nutella"


async def test_daily_log_totals_and_date_isolation(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "totals@x.com")
    for meal, amount, day in (
        ("breakfast", 30.0, "2026-07-10"),
        ("snack", 15.0, "2026-07-10"),
        ("dinner", 100.0, "2026-07-09"),  # other day — must not leak in
    ):
        resp = await client.post(
            f"{NUTRITION}/log",
            json={
                "food_item_id": cached_food.id,
                "logged_date": day,
                "meal": meal,
                "amount_g": amount,
            },
        )
        assert resp.status_code == 201

    day_log = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-10"})
    assert day_log.status_code == 200
    body = day_log.json()
    assert body["log_date"] == "2026-07-10"
    assert len(body["entries"]) == 2
    assert body["totals"]["kcal"] == round(161.7 + 80.85, 2)
    assert body["totals"]["protein_g"] == round(1.89 + 0.94, 2)


async def test_patch_amount_recomputes_snapshot(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "patcher@x.com")
    created = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-10",
            "amount_g": 30.0,
        },
    )
    entry_id = created.json()["id"]

    patched = await client.patch(
        f"{NUTRITION}/log/{entry_id}", json={"amount_g": 60.0, "meal": "lunch"}
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["meal"] == "lunch"
    assert body["kcal"] == 323.4  # 2 × the 30 g snapshot
    assert body["protein_g"] == 3.78


async def test_diary_idor_both_directions(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "victim@x.com")
    created = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-10",
            "amount_g": 30.0,
        },
    )
    entry_id = created.json()["id"]

    await _register(client, "attacker@x.com")
    assert (
        await client.patch(f"{NUTRITION}/log/{entry_id}", json={"amount_g": 1.0})
    ).status_code == 404
    assert (await client.delete(f"{NUTRITION}/log/{entry_id}")).status_code == 404
    # The attacker's own day view is empty — no cross-user leakage.
    own = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-10"})
    assert own.json()["entries"] == []


async def test_delete_entry_then_day_is_empty(
    client: AsyncClient, cached_food: FoodItem
) -> None:
    await _register(client, "deleter@x.com")
    created = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-10",
            "amount_g": 30.0,
        },
    )
    entry_id = created.json()["id"]

    assert (await client.delete(f"{NUTRITION}/log/{entry_id}")).status_code == 204
    day_log = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-10"})
    assert day_log.json()["entries"] == []
    assert day_log.json()["totals"]["kcal"] == 0.0


async def test_log_invalid_meal_rejected(client: AsyncClient, cached_food: FoodItem) -> None:
    await _register(client, "mealcheck@x.com")
    resp = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-10",
            "meal": "second-breakfast",
            "amount_g": 30.0,
        },
    )
    assert resp.status_code == 422
