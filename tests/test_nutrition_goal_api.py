"""Daily-budget API tests (P34.2) — SQLite in-memory, auth + per-user isolation.

Covers: auth required, the "no target yet" 200-with-nulls first-run state,
set/get round-trip, replace-not-duplicate on a second PUT, optional macro
targets clearing back to null, validation bounds, isolation between users, and
the log-outcome regression (a logged entry moves the day's totals, which is what
the client's "remaining" number is computed from).
"""
from __future__ import annotations

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodItem, NutritionGoal

NUTRITION = "/api/v1/nutrition"
GOAL = f"{NUTRITION}/goal"


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "password123"}
    )
    assert resp.status_code in (200, 201), resp.text
    return str(resp.json()["id"])


@pytest_asyncio.fixture
async def cached_food(test_db: AsyncSession) -> FoodItem:
    food = FoodItem(
        barcode="3017620422003",
        name="Nutella",
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


async def test_get_goal_requires_auth(client: AsyncClient) -> None:
    assert (await client.get(GOAL)).status_code == 401


async def test_put_goal_requires_auth(client: AsyncClient) -> None:
    assert (await client.put(GOAL, json={"kcal_target": 2400})).status_code == 401


# ── First run / round-trip ───────────────────────────────────────────────────


async def test_no_goal_yet_returns_200_with_nulls(client: AsyncClient) -> None:
    """"No target set" is a normal state, not a 404 — the client renders it."""
    await _register(client, "fresh@x.com")
    resp = await client.get(GOAL)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "kcal_target": None,
        "protein_target_g": None,
        "carbs_target_g": None,
        "fat_target_g": None,
        "updated_at": None,
    }


async def test_put_then_get_round_trips(client: AsyncClient) -> None:
    await _register(client, "setter@x.com")
    put = await client.put(GOAL, json={"kcal_target": 2400, "protein_target_g": 160.0})
    assert put.status_code == 200, put.text
    assert put.json()["kcal_target"] == 2400
    assert put.json()["protein_target_g"] == 160.0
    assert put.json()["updated_at"] is not None

    got = await client.get(GOAL)
    assert got.json()["kcal_target"] == 2400
    assert got.json()["protein_target_g"] == 160.0
    # Untouched optional targets stay null = "not tracked".
    assert got.json()["carbs_target_g"] is None
    assert got.json()["fat_target_g"] is None


async def test_second_put_replaces_the_single_row(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    user_id = await _register(client, "editor@x.com")
    await client.put(GOAL, json={"kcal_target": 2400, "protein_target_g": 160.0})
    await client.put(GOAL, json={"kcal_target": 2600})

    got = await client.get(GOAL)
    assert got.json()["kcal_target"] == 2600
    # Omitted macro target clears back to "not tracked" — PUT replaces, not merges.
    assert got.json()["protein_target_g"] is None

    rows = (
        (await test_db.execute(select(NutritionGoal).where(NutritionGoal.user_id == user_id)))
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_all_macro_targets_are_optional(client: AsyncClient) -> None:
    await _register(client, "kcalonly@x.com")
    resp = await client.put(GOAL, json={"kcal_target": 2000})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kcal_target"] == 2000
    assert (body["protein_target_g"], body["carbs_target_g"], body["fat_target_g"]) == (
        None,
        None,
        None,
    )


# ── Validation ────────────────────────────────────────────────────────────────


async def test_bad_targets_are_rejected_422(client: AsyncClient) -> None:
    await _register(client, "typo@x.com")
    bad_bodies: list[dict[str, object]] = [
        {},  # kcal_target is required
        {"kcal_target": -1},
        {"kcal_target": 20001},  # above the typo ceiling
        {"kcal_target": "lots"},
        {"kcal_target": 2000, "protein_target_g": -5},
        {"kcal_target": 2000, "protein_target_g": 1001},
        {"kcal_target": 2000, "fat_target_g": 5000},
    ]
    for body in bad_bodies:
        resp = await client.put(GOAL, json=body)
        assert resp.status_code == 422, f"{body} -> {resp.status_code}"


# ── Isolation ─────────────────────────────────────────────────────────────────


async def test_goals_are_per_user(client: AsyncClient) -> None:
    await _register(client, "user-a@x.com")
    await client.put(GOAL, json={"kcal_target": 2400})
    assert (await client.get(GOAL)).json()["kcal_target"] == 2400

    # Registering user B switches the cookie identity.
    await _register(client, "user-b@x.com")
    assert (await client.get(GOAL)).json()["kcal_target"] is None
    await client.put(GOAL, json={"kcal_target": 1800})
    assert (await client.get(GOAL)).json()["kcal_target"] == 1800


# ── Log-outcome regression (decision 5) ──────────────────────────────────────


async def test_logging_moves_the_days_totals(client: AsyncClient, cached_food: FoodItem) -> None:
    """The "did it save?" answer: a successful log must move the day's totals.

    The client's "remaining" is target − these totals, so a log that does not
    move them would render as a silent no-op on screen.
    """
    await _register(client, "budgeted@x.com")
    await client.put(GOAL, json={"kcal_target": 2000, "protein_target_g": 150.0})

    before = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-27"})
    assert before.json()["totals"]["kcal"] == 0

    logged = await client.post(
        f"{NUTRITION}/log",
        json={
            "food_item_id": cached_food.id,
            "logged_date": "2026-07-27",
            "meal": "breakfast",
            "amount_g": 100.0,
        },
    )
    assert logged.status_code == 201, logged.text

    after = await client.get(f"{NUTRITION}/log", params={"date": "2026-07-27"})
    totals = after.json()["totals"]
    assert totals["kcal"] == logged.json()["kcal"] == 539.0
    assert totals["protein_g"] == 6.3
    # …and the budget the client subtracts from is unchanged by logging.
    assert (await client.get(GOAL)).json()["kcal_target"] == 2000
