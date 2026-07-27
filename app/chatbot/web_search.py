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
_TIMEOUT = httpx.Timeout(connect=2.0, read=2.0, write=2.0, pool=2.0)
# Small pool — the fallback is bursty but low-volume (rate-limited to 10 chat
# req/min), and keep-alive is what actually saves the TLS handshake.
_LIMITS = httpx.Limits(max_keepalive_connections=4, max_connections=8)


@dataclass(frozen=True)
class WebResult:
    """One web search hit used both as LLM context and as a citation."""

    title: str
    url: str
    snippet: str


def create_shared_client() -> httpx.AsyncClient:
    """Build the long-lived pooled client the app lifespan owns.

    A fresh ``AsyncClient`` per search paid a full TLS handshake on every
    fallback; one pooled client keeps the connection warm across requests.
    """
    return httpx.AsyncClient(timeout=_TIMEOUT, limits=_LIMITS)


def is_available() -> bool:
    """True if a web-search provider key is configured (env only, never hardcoded)."""
    return bool(os.environ.get("WEB_SEARCH_API_KEY"))


async def search(
    query: str,
    k: int = 4,
    client: httpx.AsyncClient | None = None,
) -> list[WebResult]:
    """Return up to ``k`` web results for ``query``; [] if unavailable.

    Never raises — a missing key, network error, or bad response yields [] so the
    chat stream always continues.

    Args:
        query: The user question to search for.
        k: Maximum number of results to return.
        client: Optional shared pooled client (``app.state.http``). When omitted
            a short-lived client is created, preserving the original behaviour
            for callers outside the request path.
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
        if client is not None:
            resp = await client.post(search_url, json=payload, timeout=_TIMEOUT)
        else:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as owned:
                resp = await owned.post(search_url, json=payload)
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
