"""Query + computation helpers for the nutrition API (P27).

``snapshot_macros`` is pure and deterministic (unit-tested); the async helpers
implement the cache-first OFF lookup and the visibility rule: OFF rows are
shared, manual rows exist only for their creator (IDOR rule — a foreign manual
food behaves exactly like a missing one).
"""
from __future__ import annotations

import structlog
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodItem
from app.nutrition.off_client import fetch_product

logger = structlog.get_logger(__name__)


def snapshot_macros(food: FoodItem, amount_g: float) -> tuple[float, float, float, float]:
    """Compute the log-time macro snapshot for ``amount_g`` of ``food``.

    Args:
        food: The food whose per-100 g values are scaled.
        amount_g: Grams eaten (validated > 0 by the schema).

    Returns:
        ``(kcal, protein_g, carbs_g, fat_g)``, each rounded to 2 decimals.
    """
    factor = amount_g / 100.0
    return (
        round(food.kcal_100g * factor, 2),
        round(food.protein_100g * factor, 2),
        round(food.carbs_100g * factor, 2),
        round(food.fat_100g * factor, 2),
    )


async def get_or_fetch_food(db: AsyncSession, barcode: str) -> FoodItem | None:
    """Cache-first product lookup: ``food_items`` row, else OFF fetch + cache.

    Returns ``None`` when OFF does not know the barcode. Raises
    :class:`app.nutrition.off_client.OffUnavailableError` when OFF is down —
    the router maps that to a 503.
    """
    cached = (
        await db.execute(select(FoodItem).where(FoodItem.barcode == barcode))
    ).scalar_one_or_none()
    if cached is not None:
        return cached

    product = await fetch_product(barcode)
    if product is None:
        return None

    food = FoodItem(
        barcode=product.barcode,
        name=product.name,
        brand=product.brand,
        serving_size_g=product.serving_size_g,
        serving_label=product.serving_label,
        kcal_100g=product.kcal_100g,
        protein_100g=product.protein_100g,
        carbs_100g=product.carbs_100g,
        fat_100g=product.fat_100g,
        image_url=product.image_url,
        source="off",
    )
    db.add(food)
    try:
        await db.flush()
    except IntegrityError:
        # Two concurrent first-scans of the same barcode: the loser re-reads
        # the winner's row instead of failing the request.
        await db.rollback()
        cached = (
            await db.execute(select(FoodItem).where(FoodItem.barcode == barcode))
        ).scalar_one_or_none()
        return cached
    logger.info("off_product_cached", barcode=barcode, food_id=food.id)
    return food


async def get_visible_food(db: AsyncSession, *, user_id: str, food_id: str) -> FoodItem | None:
    """Load a food the caller may use: any OFF row, or their own manual row."""
    return (
        await db.execute(
            select(FoodItem).where(
                FoodItem.id == food_id,
                or_(FoodItem.source == "off", FoodItem.created_by == user_id),
            )
        )
    ).scalar_one_or_none()


async def search_visible_foods(
    db: AsyncSession, *, user_id: str, query: str, limit: int = 20
) -> list[FoodItem]:
    """Name/brand search over OFF cache rows + the caller's manual rows."""
    pattern = f"%{query.strip().lower()}%"
    stmt = (
        select(FoodItem)
        .where(
            or_(FoodItem.source == "off", FoodItem.created_by == user_id),
            or_(
                FoodItem.name.ilike(pattern),
                FoodItem.brand.ilike(pattern),
            ),
        )
        .order_by(FoodItem.name.asc())
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())
