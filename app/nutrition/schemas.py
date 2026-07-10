"""Pydantic request/response schemas for the nutrition API (P27)."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Meal = Literal["breakfast", "lunch", "dinner", "snack"]

# Plausible per-100 g bounds: pure fat tops out at ~900 kcal/100 g and no
# macro can exceed 100 g per 100 g of food.
KCAL_100G_MAX = 900.0
MACRO_100G_MAX = 100.0
# One diary row is capped at 5 kg — anything above is a typo, not a meal.
AMOUNT_G_MAX = 5000.0


class FoodItemOut(BaseModel):
    """A food product as served to clients (OFF-cached or manual)."""

    id: str
    barcode: str | None
    name: str
    brand: str | None
    serving_size_g: float | None
    serving_label: str | None
    kcal_100g: float
    protein_100g: float
    carbs_100g: float
    fat_100g: float
    image_url: str | None
    source: str


class ManualFoodCreate(BaseModel):
    """The "not found → type it in" fallback: a user-entered food."""

    name: str = Field(min_length=1, max_length=200)
    kcal_100g: float = Field(ge=0, le=KCAL_100G_MAX)
    protein_100g: float = Field(default=0.0, ge=0, le=MACRO_100G_MAX)
    carbs_100g: float = Field(default=0.0, ge=0, le=MACRO_100G_MAX)
    fat_100g: float = Field(default=0.0, ge=0, le=MACRO_100G_MAX)
    brand: str | None = Field(default=None, max_length=200)
    serving_size_g: float | None = Field(default=None, gt=0, le=AMOUNT_G_MAX)
    serving_label: str | None = Field(default=None, max_length=100)


class LogEntryCreate(BaseModel):
    """Add a food to the diary; macros are snapshotted server-side."""

    food_item_id: str
    logged_date: date
    meal: Meal = "snack"
    amount_g: float = Field(gt=0, le=AMOUNT_G_MAX)


class LogEntryUpdate(BaseModel):
    """Partial diary-entry update — snapshots recompute when amount changes."""

    logged_date: date | None = None
    meal: Meal | None = None
    amount_g: float | None = Field(default=None, gt=0, le=AMOUNT_G_MAX)


class LogEntryOut(BaseModel):
    """One diary row with its food detail and log-time macro snapshot."""

    id: str
    logged_date: date
    meal: str
    amount_g: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    food: FoodItemOut


class DailyTotals(BaseModel):
    """Running totals for one diary day."""

    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float


class DailyLogOut(BaseModel):
    """A full diary day: entries (insertion order) + totals."""

    log_date: date
    entries: list[LogEntryOut]
    totals: DailyTotals
