"""P35 — answer cache + speculative web fallback.

Covers the two safety-critical properties of the cache (never serves a
personalized turn; a replay is byte-identical to the original answer, footer
included) and the cancellation contract of the speculative search.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Any

import pytest

from app.chatbot import answer_cache


class _FakeRedis:
    """Minimal async Redis stand-in with a real dict behind it."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int]] = []

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int = 0) -> bool:
        self.store[key] = value
        self.set_calls.append((key, value, ex))
        return True


async def _fake_gemini_stream(
    prompt: str,
    executor: object,
    history: object = None,
    system_prompt_override: object = None,
) -> AsyncIterator[str]:
    for token in ("Fresh ", "answer."):
        yield token


def _mock_request(executor: ThreadPoolExecutor, redis_client: object) -> Any:
    state = SimpleNamespace(redis=redis_client, executor=executor, http=None)
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _events(chunks: list[str]) -> list[dict[str, Any]]:
    return [json.loads(c.removeprefix("data:").strip()) for c in chunks]


def _joined_tokens(chunks: list[str]) -> str:
    return "".join(
        str(e["token"]) for e in _events(chunks) if "token" in e and not e["done"]
    )


async def _drain(gen: AsyncIterator[str]) -> list[str]:
    return [chunk async for chunk in gen]


# --------------------------------------------------------------------------- #
# Key / TTL contract                                                           #
# --------------------------------------------------------------------------- #
def test_cache_key_normalizes_query_and_separates_exercise() -> None:
    assert answer_cache.cache_key("How  DEEP?  ", "squat") == answer_cache.cache_key(
        "how deep?", "squat"
    )
    assert answer_cache.cache_key("how deep?", "squat") != answer_cache.cache_key(
        "how deep?", "bench"
    )


def test_cache_key_is_versioned_by_the_system_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A prompt edit must invalidate every cached answer automatically."""
    before = answer_cache.cache_key("how deep should i squat", None)
    monkeypatch.setattr(answer_cache, "_PROMPT_VERSION", "deadbeef")
    assert answer_cache.cache_key("how deep should i squat", None) != before


def test_web_answers_get_the_shorter_ttl() -> None:
    assert answer_cache.ttl_for("web") == answer_cache.TTL_SECONDS_WEB
    assert answer_cache.ttl_for("rag") == answer_cache.TTL_SECONDS
    assert answer_cache.TTL_SECONDS_WEB < answer_cache.TTL_SECONDS


async def test_store_skips_conversational_and_empty_answers() -> None:
    redis_client = _FakeRedis()
    await answer_cache.store(
        redis_client,  # type: ignore[arg-type]
        "hey",
        None,
        answer_cache.CachedAnswer(text="Hi there!", source_mode="conversational"),
    )
    await answer_cache.store(
        redis_client,  # type: ignore[arg-type]
        "q",
        None,
        answer_cache.CachedAnswer(text="   ", source_mode="rag"),
    )
    assert redis_client.store == {}


async def test_load_returns_none_on_malformed_entry() -> None:
    redis_client = _FakeRedis()
    redis_client.store[answer_cache.cache_key("q", None)] = "not json"
    assert await answer_cache.load(redis_client, "q", None) is None  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# Endpoint behaviour                                                           #
# --------------------------------------------------------------------------- #
async def test_second_identical_question_replays_the_cached_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Miss writes the cache; the hit replays identical text without the LLM."""
    from app.api.v1 import chat as chat_module
    from app.api.v1.chat import ChatRequest
    from app.chatbot.rag import RetrievedChunk

    chunk = RetrievedChunk(
        text="Squat to parallel or below.",
        source="squat.md",
        title="Squat Technique",
        url="https://example.org/squat",
        distance=0.2,
    )
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [chunk])
    monkeypatch.setattr(chat_module.rag, "get_cached_chunks", lambda r, q: _none())
    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)

    redis_client = _FakeRedis()
    payload = ChatRequest(query="How deep should I squat?", exercise="squat")

    with ThreadPoolExecutor(max_workers=1) as ex:
        request = _mock_request(ex, redis_client)
        first = await _drain(chat_module._stream_tokens(request, payload))
        # The cache write is fire-and-forget — let the background task run.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        # The LLM must not be consulted on the replay.
        async def _boom(*args: object, **kwargs: object) -> AsyncIterator[str]:
            raise AssertionError("LLM was called on a cache hit")
            yield ""

        monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _boom)
        second = await _drain(chat_module._stream_tokens(request, payload))

    first_text = _joined_tokens(first)
    assert "Fresh answer." in first_text
    assert "Squat Technique" in first_text  # citations footer stored with the answer
    assert _joined_tokens(second) == first_text

    # Same shape on the wire: status first, then meta, then a done event.
    second_events = _events(second)
    assert second_events[0] == {"type": "status", "status": "thinking"}
    assert second_events[1] == {"type": "meta", "source_mode": "rag"}
    assert second_events[-1]["done"] is True


async def test_frame_and_history_turns_bypass_the_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Personalized turns are never read from nor written to the cache."""
    from app.api.v1 import chat as chat_module
    from app.api.v1.chat import ChatRequest

    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [])
    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)

    async def _no_web(query: str, k: int = 4, client: object = None) -> list[object]:
        return []

    monkeypatch.setattr(chat_module.web_search, "search", _no_web)

    async def _fake_qwen(
        prompt: str,
        frame_b64: str | None = None,
        history: object = None,
        system_prompt_override: object = None,
    ) -> AsyncIterator[str]:
        yield "visual answer"

    monkeypatch.setattr(chat_module.qwen_client, "stream_chat", _fake_qwen)

    redis_client = _FakeRedis()
    with ThreadPoolExecutor(max_workers=1) as ex:
        request = _mock_request(ex, redis_client)
        await _drain(
            chat_module._stream_tokens(
                request, ChatRequest(query="Check my depth", frame="ZmFrZQ==")
            )
        )
        await _drain(
            chat_module._stream_tokens(
                request,
                ChatRequest(
                    query="And the next set?",
                    history=[{"role": "user", "content": "hi"}],  # type: ignore[list-item]
                ),
            )
        )
        # Small talk is excluded too — it should stay varied.
        await _drain(chat_module._stream_tokens(request, ChatRequest(query="hello")))
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    assert redis_client.set_calls == []
    assert redis_client.store == {}


async def test_failed_stream_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1 import chat as chat_module
    from app.api.v1.chat import ChatRequest

    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [])

    async def _no_web(query: str, k: int = 4, client: object = None) -> list[object]:
        return []

    monkeypatch.setattr(chat_module.web_search, "search", _no_web)

    async def _failing(*args: object, **kwargs: object) -> AsyncIterator[str]:
        raise RuntimeError("gemini down")
        yield ""

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _failing)

    redis_client = _FakeRedis()
    with ThreadPoolExecutor(max_workers=1) as ex:
        request = _mock_request(ex, redis_client)
        await _drain(
            chat_module._stream_tokens(request, ChatRequest(query="how do I bench safely"))
        )
        await asyncio.sleep(0)

    assert redis_client.store == {}


# --------------------------------------------------------------------------- #
# Speculative web search                                                       #
# --------------------------------------------------------------------------- #
def test_speculation_heuristic(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v1.chat import _should_speculate_web

    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    # In-domain question → the KB should answer it, don't spend a search.
    assert not _should_speculate_web("How deep should I squat?")
    assert not _should_speculate_web("Is creatine worth taking?")
    # Recency / consumer intent → the evergreen KB can never answer it.
    assert _should_speculate_web("What is the latest deadlift world record?")
    # No in-domain vocabulary at all → very likely a KB miss.
    assert _should_speculate_web("What is the capital of France?")

    # No provider key configured → nothing to gain, never speculate.
    monkeypatch.delenv("WEB_SEARCH_API_KEY", raising=False)
    assert not _should_speculate_web("What is the capital of France?")


async def test_speculative_search_is_cancelled_on_a_confident_kb_hit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import chat as chat_module
    from app.chatbot.rag import RetrievedChunk

    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    outcome: dict[str, bool] = {"cancelled": False, "completed": False}

    async def _slow_search(query: str, k: int = 4, client: object = None) -> list[object]:
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            outcome["cancelled"] = True
            raise
        outcome["completed"] = True
        return []

    monkeypatch.setattr(chat_module.web_search, "search", _slow_search)
    # Force speculation regardless of vocabulary, then return a confident hit.
    monkeypatch.setattr(chat_module, "_should_speculate_web", lambda q: True)
    chunk = RetrievedChunk(
        text="Neutral spine.", source="deadlift.md", title="Deadlift", url="", distance=0.2
    )
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [chunk])

    with ThreadPoolExecutor(max_workers=1) as ex:
        request = _mock_request(ex, None)
        context, citations, mode = await asyncio.wait_for(
            chat_module._gather_context("anything", request), timeout=2.0
        )

    assert mode == "rag"
    assert context == ["Neutral spine."]
    assert citations == ["Deadlift"]
    assert outcome["cancelled"] is True
    assert outcome["completed"] is False
    # Nothing left pending: no stray speculative task survives the call.
    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    assert pending == []


async def test_speculative_result_is_used_when_the_kb_misses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import chat as chat_module
    from app.chatbot.web_search import WebResult

    monkeypatch.setenv("WEB_SEARCH_API_KEY", "k")
    calls: list[str] = []

    async def _search(query: str, k: int = 4, client: object = None) -> list[WebResult]:
        calls.append(query)
        return [WebResult(title="ACSM", url="https://acsm.org/x", snippet="Guidance.")]

    monkeypatch.setattr(chat_module.web_search, "search", _search)
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [])

    with ThreadPoolExecutor(max_workers=1) as ex:
        request = _mock_request(ex, None)
        context, citations, mode = await chat_module._gather_context(
            "capital of France", request
        )

    assert mode == "web"
    assert citations == ["ACSM (https://acsm.org/x)"]
    assert "Guidance." in context[0]
    # Speculation must not double-search: exactly one call was made.
    assert len(calls) == 1


async def _none() -> None:
    """Awaitable ``None`` — stands in for a retrieval-cache miss."""
    return None
