"""Nutrition routes (P27): barcode lookup, manual foods, and the food diary.

Mirrors ``workouts.py``: ``get_current_user`` on every route, async handlers,
structlog, every per-user query filtered by ``user_id == current_user.id``
(IDOR rule — foreign ids return 404, indistinguishable from missing ones).

The barcode lookup is cache-first against ``food_items``; only a cache miss
reaches Open Food Facts, and the route is rate-limited to protect OFF's
15 reads/min/IP quota from the server's single egress IP.

NOTE: deliberately NOT using ``from __future__ import annotations`` — slowapi
wraps the decorated handler and breaks under stringified annotations (see the
same note in ``auth.py``).
"""

import re
from datetime import date

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user
from app.db import get_db
from app.models import FoodItem, FoodLogEntry, User
from app.nutrition.off_client import OffUnavailableError
from app.nutrition.schemas import (
    DailyLogOut,
    DailyTotals,
    FoodItemOut,
    LogEntryCreate,
    LogEntryOut,
    LogEntryUpdate,
    ManualFoodCreate,
)
from app.nutrition.service import (
    get_or_fetch_food,
    get_visible_food,
    search_visible_foods,
    snapshot_macros,
)
from app.rate_limit import NUTRITION_RATE_LIMIT, limiter

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/nutrition", tags=["nutrition"])

# EAN-8 through EAN-14/UPC — digits only; anything else never reaches OFF.
BARCODE_RE = re.compile(r"^\d{6,14}$")


# ── Response mappers ──────────────────────────────────────────────────────────


def _food_out(f: FoodItem) -> FoodItemOut:
    return FoodItemOut(
        id=f.id,
        barcode=f.barcode,
        name=f.name,
        brand=f.brand,
        serving_size_g=f.serving_size_g,
        serving_label=f.serving_label,
        kcal_100g=f.kcal_100g,
        protein_100g=f.protein_100g,
        carbs_100g=f.carbs_100g,
        fat_100g=f.fat_100g,
        image_url=f.image_url,
        source=f.source,
    )


def _entry_out(e: FoodLogEntry) -> LogEntryOut:
    return LogEntryOut(
        id=e.id,
        logged_date=e.logged_date,
        meal=e.meal,
        amount_g=e.amount_g,
        kcal=e.kcal,
        protein_g=e.protein_g,
        carbs_g=e.carbs_g,
        fat_g=e.fat_g,
        food=_food_out(e.food_item),
    )


async def _load_owned_entry(
    db: AsyncSession, *, user_id: str, entry_id: str
) -> FoodLogEntry:
    """Load a diary entry the caller owns, or 404 (foreign == missing)."""
    entry = (
        await db.execute(
            select(FoodLogEntry)
            .where(FoodLogEntry.id == entry_id, FoodLogEntry.user_id == user_id)
            .options(selectinload(FoodLogEntry.food_item))
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="entry not found")
    return entry


# ── Products / foods ─────────────────────────────────────────────────────────


@router.get("/products/{barcode}", response_model=FoodItemOut)
@limiter.limit(NUTRITION_RATE_LIMIT)
async def lookup_product(
    request: Request,
    barcode: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FoodItemOut:
    """Barcode → product macros; cache-first, OFF on first sight only."""
    if not BARCODE_RE.fullmatch(barcode):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="barcode must be 6-14 digits",
        )
    try:
        food = await get_or_fetch_food(db, barcode)
    except OffUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="food database unreachable — try again shortly",
        ) from exc
    if food is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")
    logger.info("nutrition_lookup", user_id=current_user.id, barcode=barcode, source=food.source)
    return _food_out(food)


@router.post("/foods", response_model=FoodItemOut, status_code=status.HTTP_201_CREATED)
async def create_manual_food(
    payload: ManualFoodCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FoodItemOut:
    """The "not found → type it in" fallback: a food only its creator sees."""
    food = FoodItem(
        name=payload.name.strip(),
        brand=payload.brand,
        serving_size_g=payload.serving_size_g,
        serving_label=payload.serving_label,
        kcal_100g=payload.kcal_100g,
        protein_100g=payload.protein_100g,
        carbs_100g=payload.carbs_100g,
        fat_100g=payload.fat_100g,
        source="manual",
        created_by=current_user.id,
    )
    db.add(food)
    await db.flush()
    logger.info("manual_food_created", user_id=current_user.id, food_id=food.id)
    return _food_out(food)


@router.get("/foods/search", response_model=list[FoodItemOut])
async def search_foods(
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FoodItemOut]:
    """Search cached OFF products + the caller's own manual foods."""
    foods = await search_visible_foods(db, user_id=current_user.id, query=q, limit=limit)
    return [_food_out(f) for f in foods]


# ── Diary ─────────────────────────────────────────────────────────────────────


@router.post("/log", response_model=LogEntryOut, status_code=status.HTTP_201_CREATED)
async def create_log_entry(
    payload: LogEntryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LogEntryOut:
    """Log a food to the diary; macros are snapshotted server-side."""
    food = await get_visible_food(db, user_id=current_user.id, food_id=payload.food_item_id)
    if food is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="food not found")
    kcal, protein_g, carbs_g, fat_g = snapshot_macros(food, payload.amount_g)
    entry = FoodLogEntry(
        user_id=current_user.id,
        food_item_id=food.id,
        logged_date=payload.logged_date,
        meal=payload.meal,
        amount_g=payload.amount_g,
        kcal=kcal,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
    )
    db.add(entry)
    await db.flush()
    entry.food_item = food
    logger.info(
        "food_logged",
        user_id=current_user.id,
        entry_id=entry.id,
        meal=entry.meal,
        logged_date=str(entry.logged_date),
    )
    return _entry_out(entry)


@router.get("/log", response_model=DailyLogOut)
async def get_daily_log(
    log_date: date = Query(alias="date"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DailyLogOut:
    """One diary day: the caller's entries plus running totals."""
    entries = list(
        (
            await db.execute(
                select(FoodLogEntry)
                .where(
                    FoodLogEntry.user_id == current_user.id,
                    FoodLogEntry.logged_date == log_date,
                )
                .options(selectinload(FoodLogEntry.food_item))
                .order_by(FoodLogEntry.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    totals = DailyTotals(
        kcal=round(sum(e.kcal for e in entries), 2),
        protein_g=round(sum(e.protein_g for e in entries), 2),
        carbs_g=round(sum(e.carbs_g for e in entries), 2),
        fat_g=round(sum(e.fat_g for e in entries), 2),
    )
    return DailyLogOut(log_date=log_date, entries=[_entry_out(e) for e in entries], totals=totals)


@router.patch("/log/{entry_id}", response_model=LogEntryOut)
async def update_log_entry(
    entry_id: str,
    payload: LogEntryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LogEntryOut:
    """Amend a diary row; a changed amount recomputes the macro snapshot."""
    entry = await _load_owned_entry(db, user_id=current_user.id, entry_id=entry_id)
    if payload.logged_date is not None:
        entry.logged_date = payload.logged_date
    if payload.meal is not None:
        entry.meal = payload.meal
    if payload.amount_g is not None:
        entry.amount_g = payload.amount_g
        entry.kcal, entry.protein_g, entry.carbs_g, entry.fat_g = snapshot_macros(
            entry.food_item, payload.amount_g
        )
    await db.flush()
    logger.info("food_log_updated", user_id=current_user.id, entry_id=entry.id)
    return _entry_out(entry)


@router.delete("/log/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_log_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a diary row the caller owns."""
    entry = await _load_owned_entry(db, user_id=current_user.id, entry_id=entry_id)
    await db.delete(entry)
    await db.flush()
    logger.info("food_log_deleted", user_id=current_user.id, entry_id=entry_id)
