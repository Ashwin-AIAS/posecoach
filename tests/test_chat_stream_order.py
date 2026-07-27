"""P35 — SSE event ordering: the status event must never wait on retrieval.

The perceived-latency bug this locks down: ``_stream_tokens`` used to await
``_gather_context()`` (embed + ChromaDB + up to a 2 s web-search round-trip)
*before* emitting ``status: thinking``, so the client sat blank while the
server was already working. The status event is now the first statement of the
generator, before any await.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient


async def _fake_gemini_stream(
    prompt: str,
    executor: object,
    history: object = None,
    system_prompt_override: object = None,
) -> AsyncIterator[str]:
    yield "ok"


def _mock_request(executor: ThreadPoolExecutor) -> Any:
    """Minimal stand-in for a FastAPI Request (only app.state is touched)."""
    state = SimpleNamespace(redis=None, executor=executor, http=None)
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _payload(query: str) -> Any:
    from app.api.v1.chat import ChatRequest

    return ChatRequest(query=query)


async def test_status_event_is_emitted_before_retrieval_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First yielded event is the status event, with retrieval not yet begun."""
    from app.api.v1 import chat as chat_module

    retrieval_started = asyncio.Event()
    release = asyncio.Event()

    async def _slow_gather(query: str, request: object) -> tuple[list[str], list[str], str]:
        retrieval_started.set()
        await release.wait()
        return [], [], "none"

    monkeypatch.setattr(chat_module, "_gather_context", _slow_gather)
    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)

    with ThreadPoolExecutor(max_workers=1) as ex:
        gen = chat_module._stream_tokens(_mock_request(ex), _payload("how deep should I squat"))
        try:
            first = await asyncio.wait_for(gen.__anext__(), timeout=2.0)
            event = json.loads(first.removeprefix("data:").strip())
            assert event == {"type": "status", "status": "thinking"}
            # The generator has not run any awaitable work yet — proof the status
            # event does not sit behind embed + Chroma + web search.
            assert not retrieval_started.is_set()

            # Let the (stubbed) retrieval finish and drain the rest cleanly.
            release.set()
            rest = [chunk async for chunk in gen]
        finally:
            await gen.aclose()

    assert retrieval_started.is_set()
    kinds = [json.loads(c.removeprefix("data:").strip()) for c in rest]
    assert kinds[0] == {"type": "meta", "source_mode": "none"}
    assert kinds[-1]["done"] is True


async def test_first_wire_event_is_status_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    """Through the real endpoint, event[0] is status and event[1] is meta."""
    from app.api.v1 import chat as chat_module
    from app.main import app

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [])

    async def _no_web(query: str, k: int = 4, client: object = None) -> list[object]:
        return []

    monkeypatch.setattr(chat_module.web_search, "search", _no_web)

    if not hasattr(app.state, "executor"):
        app.state.executor = ThreadPoolExecutor(max_workers=1)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/chat/stream", json={"query": "anything at all"})

    events = [
        json.loads(raw.strip().removeprefix("data:").strip())
        for raw in resp.content.decode().split("\n\n")
        if raw.strip().startswith("data:")
    ]
    assert events[0] == {"type": "status", "status": "thinking"}
    assert events[1]["type"] == "meta"


async def test_retrieval_cache_write_does_not_block_the_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Redis write of retrieved chunks is fire-and-forget, not awaited."""
    from app.api.v1 import chat as chat_module
    from app.chatbot.rag import RetrievedChunk

    chunk = RetrievedChunk(
        text="Brace before you descend.",
        source="squat.md",
        title="Squat",
        url="",
        distance=0.2,
    )
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [chunk])

    write_started = asyncio.Event()
    write_release = asyncio.Event()

    async def _slow_set(redis_client: object, query: str, chunks: object, ttl: int = 0) -> None:
        write_started.set()
        await write_release.wait()

    monkeypatch.setattr(chat_module.rag, "set_cached_chunks", _slow_set)

    async def _miss(redis_client: object, query: str) -> None:
        return None

    monkeypatch.setattr(chat_module.rag, "get_cached_chunks", _miss)

    with ThreadPoolExecutor(max_workers=1) as ex:
        state = SimpleNamespace(redis=object(), executor=ex, http=None)
        request = SimpleNamespace(app=SimpleNamespace(state=state))
        context, citations, mode = await asyncio.wait_for(
            chat_module._gather_context("how deep should I squat", request), timeout=2.0
        )

    # Returned while the (stubbed, still-blocked) cache write is in flight.
    assert mode == "rag"
    assert context == [chunk.text]
    assert citations == ["Squat"]
    write_release.set()
    await asyncio.sleep(0)  # let the background task settle
