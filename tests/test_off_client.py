"""Open Food Facts client tests (P27) — respx-mocked, no network.

Covers payload parsing (including OFF's mixed str/number fields), the
User-Agent requirement, miss detection (HTTP 404 and ``status: 0`` bodies),
and error mapping (5xx / 429 / network failure → ``OffUnavailableError``).
"""
from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from app.nutrition.off_client import (
    OFF_BASE_URL,
    OffUnavailableError,
    fetch_product,
    parse_product,
)

BARCODE = "3017620422003"
URL = f"{OFF_BASE_URL}/{BARCODE}"


def _payload(**overrides: Any) -> dict[str, Any]:
    product: dict[str, Any] = {
        "product_name": "Nutella",
        "brands": "Ferrero, Nutella",
        "serving_size": "1 tbsp (15 g)",
        "serving_quantity": "15",
        "image_front_small_url": "https://images.openfoodfacts.org/nutella.jpg",
        "nutriments": {
            "energy-kcal_100g": 539,
            "proteins_100g": 6.3,
            "carbohydrates_100g": 57.5,
            "fat_100g": 30.9,
        },
    }
    product.update(overrides)
    return {"code": BARCODE, "status": 1, "product": product}


@respx.mock
async def test_fetch_parses_product_and_sends_user_agent() -> None:
    route = respx.get(URL).mock(return_value=httpx.Response(200, json=_payload()))

    product = await fetch_product(BARCODE)

    assert product is not None
    assert product.name == "Nutella"
    assert product.brand == "Ferrero"  # first of the comma-separated brands
    assert product.serving_size_g == 15.0  # string "15" coerced
    assert product.serving_label == "1 tbsp (15 g)"
    assert product.kcal_100g == 539.0
    assert product.protein_100g == 6.3
    assert product.carbs_100g == 57.5
    assert product.fat_100g == 30.9
    assert product.image_url == "https://images.openfoodfacts.org/nutella.jpg"

    request = route.calls.last.request
    assert "PoseCoach" in request.headers["User-Agent"]
    assert "fields=" in str(request.url)  # payload trimmed, not the full document


@respx.mock
async def test_fetch_http_404_returns_none() -> None:
    respx.get(URL).mock(return_value=httpx.Response(404, json={"status": 0}))
    assert await fetch_product(BARCODE) is None


@respx.mock
async def test_fetch_status_zero_body_returns_none() -> None:
    respx.get(URL).mock(
        return_value=httpx.Response(200, json={"code": BARCODE, "status": 0})
    )
    assert await fetch_product(BARCODE) is None


@respx.mock
async def test_fetch_server_error_raises_unavailable() -> None:
    respx.get(URL).mock(return_value=httpx.Response(500))
    with pytest.raises(OffUnavailableError):
        await fetch_product(BARCODE)


@respx.mock
async def test_fetch_rate_limited_raises_unavailable() -> None:
    respx.get(URL).mock(return_value=httpx.Response(429))
    with pytest.raises(OffUnavailableError):
        await fetch_product(BARCODE)


@respx.mock
async def test_fetch_network_failure_raises_unavailable() -> None:
    respx.get(URL).mock(side_effect=httpx.ConnectError("boom"))
    with pytest.raises(OffUnavailableError):
        await fetch_product(BARCODE)


def test_parse_product_without_name_is_unusable() -> None:
    assert parse_product(BARCODE, _payload(product_name="  ")) is None
    assert parse_product(BARCODE, {"status": 1}) is None


def test_parse_product_missing_nutriments_defaults_to_zero() -> None:
    product = parse_product(BARCODE, _payload(nutriments={}))
    assert product is not None
    assert product.kcal_100g == 0.0
    assert product.protein_100g == 0.0
    assert product.carbs_100g == 0.0
    assert product.fat_100g == 0.0


def test_parse_product_bad_serving_quantity_is_none() -> None:
    product = parse_product(BARCODE, _payload(serving_quantity="a spoonful"))
    assert product is not None
    assert product.serving_size_g is None
