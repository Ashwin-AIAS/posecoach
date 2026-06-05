"""Live web-search fallback for the chatbot.

When local RAG can't confidently answer (the question is outside the curated
knowledge base), the chat endpoint calls :func:`search` to fetch fresh results
the LLM can ground a cited answer in. Provider is Tavily by default; the API key
comes from ``WEB_SEARCH_API_KEY`` (env only, never hardcoded). With no key — or
on any error — this degrades gracefully to an empty list, and the LLM simply
answers from general knowledge.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import httpx
import structlog

logger = structlog.get_logger(__name__)

# Tavily exposes a simple POST search API that returns clean snippets + URLs.
DEFAULT_SEARCH_URL = "https://api.tavily.com/search"
_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)


@dataclass(frozen=True)
class WebResult:
    """One web search hit used both as LLM context and as a citation."""

    title: str
    url: str
    snippet: str


async def search(query: str, k: int = 4) -> list[WebResult]:
    """Return up to ``k`` web results for ``query``; [] if unavailable.

    Never raises — a missing key, network error, or bad response yields [] so the
    chat stream always continues.
    """
    api_key = os.environ.get("WEB_SEARCH_API_KEY")
    if not api_key or not query.strip():
        return []
    search_url = os.environ.get("WEB_SEARCH_URL", DEFAULT_SEARCH_URL)
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": k,
        "search_depth": "basic",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(search_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — fallback must never crash chat
        logger.warning("web_search_failed", error=str(exc))
        return []

    results = data.get("results", []) if isinstance(data, dict) else []
    out: list[WebResult] = []
    for item in results[:k]:
        if not isinstance(item, dict):
            continue
        out.append(
            WebResult(
                title=str(item.get("title", "")),
                url=str(item.get("url", "")),
                snippet=str(item.get("content", "")),
            )
        )
    logger.info("web_search_complete", query_len=len(query), results=len(out))
    return out
