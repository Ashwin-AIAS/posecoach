"""P24.1 startup-seed tests — seed when empty, skip (no fetch) when populated.

Verifies the count-gated ``seed_if_empty`` that the app's startup hook calls:
an empty ``exercises`` table triggers a fetch + upsert, while a populated one
short-circuits without touching the network. SQLite in-memory, no real network.
"""
from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import scripts.seed_exercises as seed
from app.models import Exercise

SAMPLE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "Barbell_Squat",
        "name": "Barbell Squat",
        "category": "strength",
        "equipment": "barbell",
        "primaryMuscles": ["quadriceps"],
        "secondaryMuscles": ["glutes"],
        "instructions": ["Squat to depth."],
        "images": ["Barbell_Squat/0.jpg"],
    },
    {
        "id": "Bench_Press",
        "name": "Bench Press",
        "category": "strength",
        "equipment": "barbell",
        "primaryMuscles": ["chest"],
        "secondaryMuscles": ["triceps"],
        "instructions": ["Press the bar."],
        "images": [],
    },
]


async def _count(session: AsyncSession) -> int:
    return (await session.execute(select(func.count()).select_from(Exercise))).scalar_one()


async def test_seed_if_empty_seeds_when_table_empty(
    test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = {"n": 0}

    async def fake_fetch(url: str = seed.FREE_EXERCISE_DB_URL) -> list[dict[str, Any]]:
        calls["n"] += 1
        return SAMPLE_CATALOG

    monkeypatch.setattr(seed, "fetch_catalog", fake_fetch)

    summary = await seed.seed_if_empty(test_db)

    assert calls["n"] == 1  # fetched exactly once
    assert summary is not None
    assert summary.total == 2
    assert summary.inserted == 2
    assert await _count(test_db) == 2


async def test_seed_if_empty_skips_when_populated_without_fetching(
    test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Pre-populate the catalog so the gate should short-circuit.
    test_db.add(Exercise(slug="existing", name="Existing", is_cv_supported=False))
    await test_db.commit()

    calls = {"n": 0}

    async def fake_fetch(url: str = seed.FREE_EXERCISE_DB_URL) -> list[dict[str, Any]]:
        calls["n"] += 1
        return SAMPLE_CATALOG

    monkeypatch.setattr(seed, "fetch_catalog", fake_fetch)

    summary = await seed.seed_if_empty(test_db)

    assert summary is None  # skipped
    assert calls["n"] == 0  # never hit the network
    assert await _count(test_db) == 1  # unchanged
