"""Web-search fallback tests — httpx is mocked with respx, never a real API."""
from __future__ import annotations

import httpx
import pytest
import respx

from app.chatbot import web_search
from app.chatbot.web_search import DEFAULT_SEARCH_URL


async def test_no_api_key_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WEB_SEARCH_API_KEY", raising=False)
    assert await web_search.search("anything") == []


async def test_blank_query_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    assert await web_search.search("   ") == []


@respx.mock
async def test_parses_results_into_webresults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    respx.post(DEFAULT_SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Creatine 101", "url": "https://ex.org/c", "content": "3-5 g/day."},
                    {"title": "Protein", "url": "https://ex.org/p", "content": "1.6 g/kg."},
                ]
            },
        )
    )
    results = await web_search.search("creatine dose", k=4)
    assert [r.title for r in results] == ["Creatine 101", "Protein"]
    assert results[0].url == "https://ex.org/c"
    assert "3-5 g/day" in results[0].snippet


@respx.mock
async def test_http_error_degrades_to_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    respx.post(DEFAULT_SEARCH_URL).mock(return_value=httpx.Response(500))
    assert await web_search.search("creatine") == []


@respx.mock
async def test_respects_k_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    respx.post(DEFAULT_SEARCH_URL).mock(
        return_value=httpx.Response(
            200,
            json={"results": [{"title": f"r{i}", "url": f"u{i}", "content": "c"} for i in range(6)]},
        )
    )
    results = await web_search.search("q", k=3)
    assert len(results) == 3
