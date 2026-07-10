"""P27 nutrition model tests — additive schema, SQLite in-memory.

Uses a dedicated FK-enforcing engine (``PRAGMA foreign_keys=ON``) so the
``ondelete=CASCADE`` behaviour is actually exercised — the shared conftest
engine leaves SQLite foreign-key enforcement off.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import date
from typing import Any

import pytest_asyncio
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db import Base
from app.models import FoodItem, FoodLogEntry, User


@pytest_asyncio.fixture
async def fk_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_fk(dbapi_conn: Any, _record: Any) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


async def _make_user(session: AsyncSession, email: str = "eater@example.com") -> User:
    user = User(email=email, hashed_password="x")
    session.add(user)
    await session.flush()
    return user


def _off_food(barcode: str = "3017620422003") -> FoodItem:
    return FoodItem(
        barcode=barcode,
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


async def _count(session: AsyncSession, model: type[Any]) -> int:
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


async def test_food_item_and_log_entry_roundtrip(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    food = _off_food()
    fk_session.add(food)
    await fk_session.flush()

    entry = FoodLogEntry(
        user_id=user.id,
        food_item_id=food.id,
        logged_date=date(2026, 7, 10),
        meal="breakfast",
        amount_g=30.0,
        kcal=161.7,
        protein_g=1.89,
        carbs_g=17.25,
        fat_g=9.27,
    )
    fk_session.add(entry)
    await fk_session.commit()

    loaded = (
        await fk_session.execute(select(FoodLogEntry).where(FoodLogEntry.id == entry.id))
    ).scalar_one()
    assert loaded.meal == "breakfast"
    assert loaded.amount_g == 30.0
    assert loaded.kcal == 161.7
    # OFF cache row: shared, no owner.
    assert food.created_by is None
    assert food.source == "off"


async def test_user_delete_cascades_entries_and_manual_foods(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    manual = FoodItem(
        name="Mom's dal", kcal_100g=120.0, source="manual", created_by=user.id
    )
    off_row = _off_food()
    fk_session.add_all([manual, off_row])
    await fk_session.flush()
    fk_session.add_all(
        [
            FoodLogEntry(
                user_id=user.id,
                food_item_id=manual.id,
                logged_date=date(2026, 7, 10),
                amount_g=200.0,
                kcal=240.0,
            ),
            FoodLogEntry(
                user_id=user.id,
                food_item_id=off_row.id,
                logged_date=date(2026, 7, 10),
                amount_g=15.0,
                kcal=80.9,
            ),
        ]
    )
    await fk_session.commit()

    await fk_session.delete(user)
    await fk_session.commit()

    # GDPR: the user's diary and their manual foods are gone…
    assert await _count(fk_session, FoodLogEntry) == 0
    # …but the shared OFF cache row survives (created_by is NULL).
    remaining = (await fk_session.execute(select(FoodItem))).scalars().all()
    assert [f.source for f in remaining] == ["off"]


async def test_food_delete_cascades_its_entries(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    food = _off_food()
    fk_session.add(food)
    await fk_session.flush()
    fk_session.add(
        FoodLogEntry(
            user_id=user.id,
            food_item_id=food.id,
            logged_date=date(2026, 7, 9),
            amount_g=100.0,
            kcal=539.0,
        )
    )
    await fk_session.commit()

    await fk_session.delete(food)
    await fk_session.commit()

    assert await _count(fk_session, FoodLogEntry) == 0
    assert await _count(fk_session, User) == 1  # user untouched


async def test_barcode_unique_and_nullable(fk_session: AsyncSession) -> None:
    user = await _make_user(fk_session)
    # Two manual foods with NULL barcodes coexist (NULLs don't collide in a
    # unique index).
    fk_session.add_all(
        [
            FoodItem(name="Rice", kcal_100g=130.0, source="manual", created_by=user.id),
            FoodItem(name="Roti", kcal_100g=264.0, source="manual", created_by=user.id),
        ]
    )
    await fk_session.commit()
    assert await _count(fk_session, FoodItem) == 2
