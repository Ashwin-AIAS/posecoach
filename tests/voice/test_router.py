"""GET /api/v1/voice/personas and GET /api/v1/voice/manifest (P29 S3).

Read-only, unauthenticated, cached — no DB, no auth dependency.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.voice import router as voice_router_module
from app.voice.personas import PERSONA_KEYS


@pytest.fixture(autouse=True)
def _clear_manifest_cache() -> None:
    """The manifest loader is process-lifetime cached (lru_cache) — clear it
    before and after each test so tests that swap MANIFEST_PATH don't leak
    into each other or into other test modules."""
    voice_router_module._load_manifest.cache_clear()
    yield
    voice_router_module._load_manifest.cache_clear()


async def test_list_personas_returns_all_three_with_expected_shape(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/voice/personas")

    assert resp.status_code == 200
    body = resp.json()
    assert {p["key"] for p in body} == set(PERSONA_KEYS)
    for persona in body:
        assert set(persona) == {"key", "name", "tone", "voice_texture"}
        assert persona["name"]
        assert persona["tone"]
        assert persona["voice_texture"]
        # Internal fields must never leak through the public API.
        assert "prompt_fragment" not in persona
        assert "voice_id" not in persona


async def test_list_personas_sets_cache_control_header(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/voice/personas")

    assert resp.headers["cache-control"] == "public, max-age=86400"


async def test_get_manifest_returns_parsed_manifest_when_present(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(
        json.dumps({"atlas.mismatch": {"file": "atlas/mismatch.mp3", "hash": "abc123", "dur_ms": 1200}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(voice_router_module, "MANIFEST_PATH", manifest_path)

    resp = await client.get("/api/v1/voice/manifest")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"atlas.mismatch": {"file": "atlas/mismatch.mp3", "hash": "abc123", "dur_ms": 1200}}


async def test_get_manifest_sets_cache_control_header(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({}), encoding="utf-8")
    monkeypatch.setattr(voice_router_module, "MANIFEST_PATH", manifest_path)

    resp = await client.get("/api/v1/voice/manifest")

    assert resp.headers["cache-control"] == "public, max-age=86400"


async def test_get_manifest_missing_file_returns_404(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(voice_router_module, "MANIFEST_PATH", tmp_path / "does-not-exist.json")

    resp = await client.get("/api/v1/voice/manifest")

    assert resp.status_code == 404


async def test_get_manifest_reflects_the_real_committed_manifest(client: AsyncClient) -> None:
    """Sanity check against the real S2 output — no monkeypatching."""
    resp = await client.get("/api/v1/voice/manifest")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 141
    assert "atlas.mismatch" in body
    entry = body["atlas.mismatch"]
    assert set(entry) == {"file", "hash", "dur_ms"}
