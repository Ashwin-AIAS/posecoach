"""Open Food Facts (OFF) API v2 client — read-only, no API key (P27).

OFF policy requires a descriptive ``User-Agent`` (env ``OFF_USER_AGENT``; set a
contact email in production) and caps anonymous product reads at ~15/min/IP.
The nutrition router caches every successful lookup in ``food_items``, so a
given barcode reaches this client at most once for the app's lifetime.
"""
from __future__ import annotations

import os
from typing import Any

import httpx
import structlog
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

OFF_BASE_URL = "https://world.openfoodfacts.org/api/v2/product"
OFF_TIMEOUT_SECONDS = 10.0
DEFAULT_USER_AGENT = "PoseCoach/1.0 (thesis project)"
# Trim the payload — OFF returns the full ~100-field document otherwise.
OFF_FIELDS = ",".join(
    (
        "code",
        "product_name",
        "brands",
        "serving_size",
        "serving_quantity",
        "image_front_small_url",
        "nutriments",
    )
)


class OffUnavailableError(Exception):
    """OFF could not be reached or answered with a server error."""


class OffProduct(BaseModel):
    """The subset of an OFF product the tracker stores and shows."""

    barcode: str
    name: str
    brand: str | None
    serving_size_g: float | None
    serving_label: str | None
    kcal_100g: float
    protein_100g: float
    carbs_100g: float
    fat_100g: float
    image_url: str | None


def _as_float(value: Any) -> float | None:
    """Coerce OFF's mixed str/number fields to float; ``None`` when absent/bad."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_product(barcode: str, payload: dict[str, Any]) -> OffProduct | None:
    """Map an OFF v2 response body to :class:`OffProduct`.

    Returns ``None`` for unusable rows (missing/blank product name) — OFF data
    is crowd-sourced and some entries are stubs.
    """
    product: dict[str, Any] = payload.get("product") or {}
    name = str(product.get("product_name") or "").strip()
    if not name:
        return None
    nutriments: dict[str, Any] = product.get("nutriments") or {}
    brand_raw = str(product.get("brands") or "").strip()
    serving_label = str(product.get("serving_size") or "").strip() or None
    return OffProduct(
        barcode=barcode,
        name=name,
        # "brands" is a comma-separated list; the first one is the main brand.
        brand=brand_raw.split(",")[0].strip() or None if brand_raw else None,
        serving_size_g=_as_float(product.get("serving_quantity")),
        serving_label=serving_label,
        kcal_100g=_as_float(nutriments.get("energy-kcal_100g")) or 0.0,
        protein_100g=_as_float(nutriments.get("proteins_100g")) or 0.0,
        carbs_100g=_as_float(nutriments.get("carbohydrates_100g")) or 0.0,
        fat_100g=_as_float(nutriments.get("fat_100g")) or 0.0,
        image_url=str(product.get("image_front_small_url") or "").strip() or None,
    )


async def fetch_product(barcode: str) -> OffProduct | None:
    """Fetch one product from OFF by barcode.

    Args:
        barcode: Digits-only EAN/UPC code (validated by the caller).

    Returns:
        The parsed product, or ``None`` when OFF does not know the barcode
        (or the entry is an unusable stub).

    Raises:
        OffUnavailableError: On network failure, timeout, 429 or 5xx — the
            caller maps this to a 503 so the client can retry later.
    """
    headers = {"User-Agent": os.environ.get("OFF_USER_AGENT", DEFAULT_USER_AGENT)}
    try:
        async with httpx.AsyncClient(timeout=OFF_TIMEOUT_SECONDS, headers=headers) as client:
            resp = await client.get(f"{OFF_BASE_URL}/{barcode}", params={"fields": OFF_FIELDS})
    except httpx.HTTPError as exc:
        logger.warning("off_request_failed", barcode=barcode, error=str(exc))
        raise OffUnavailableError(str(exc)) from exc

    if resp.status_code == 404:
        return None
    if resp.status_code == 429 or resp.status_code >= 500:
        logger.warning("off_server_error", barcode=barcode, status=resp.status_code)
        raise OffUnavailableError(f"OFF returned {resp.status_code}")
    if resp.status_code != 200:
        logger.warning("off_unexpected_status", barcode=barcode, status=resp.status_code)
        return None

    payload: dict[str, Any] = resp.json()
    # v0-style bodies (and some v2 edge responses) mark misses with status: 0.
    if payload.get("status") == 0:
        return None
    product = parse_product(barcode, payload)
    logger.info("off_product_fetched", barcode=barcode, found=product is not None)
    return product
