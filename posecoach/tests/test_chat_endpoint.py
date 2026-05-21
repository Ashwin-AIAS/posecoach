"""SSE endpoint tests — LLM clients are monkeypatched, no network."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient


async def _fake_gemini_stream(prompt: str, executor: object) -> AsyncIterator[str]:
    for token in ("Hello ", "from ", "Gemini."):
        yield token


async def _fake_qwen_stream(prompt: str, frame_b64: str | None = None) -> AsyncIterator[str]:
    for token in ("Hello ", "from ", "Qwen."):
        yield token


async def _failing_gemini_stream(prompt: str, executor: object) -> AsyncIterator[str]:
    raise RuntimeError("gemini down")
    yield  # unreachable — keeps the function an async generator


def _parse_sse(body: bytes) -> list[dict[str, object]]:
    events = []
    for raw in body.decode("utf-8").split("\n\n"):
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        events.append(json.loads(line[5:].strip()))
    return events


@pytest.fixture
def patched_app(monkeypatch: pytest.MonkeyPatch) -> object:
    from app.api.v1 import chat as chat_module
    from app.main import app

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)
    monkeypatch.setattr(chat_module.qwen_client, "stream_chat", _fake_qwen_stream)
    monkeypatch.setattr(chat_module.rag, "retrieve", lambda q, top_k=3: ["fake chunk"])

    # Provide an executor for the gemini path (lifespan doesn't run in tests)
    from concurrent.futures import ThreadPoolExecutor

    if not hasattr(app.state, "executor"):
        app.state.executor = ThreadPoolExecutor(max_workers=1)
    return app


async def test_chat_stream_text_query_uses_gemini(patched_app: object) -> None:
    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/chat/stream",
            json={"query": "How deep should I squat?", "exercise": "squat"},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.content)
    tokens = [e["token"] for e in events if not e["done"]]
    assert "".join(tokens) == "Hello from Gemini."
    assert events[-1]["done"] is True


async def test_chat_stream_with_frame_uses_qwen(patched_app: object) -> None:
    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/chat/stream",
            json={"query": "Check my form", "frame": "fake_base64_jpeg"},
        )
    assert resp.status_code == 200
    events = _parse_sse(resp.content)
    tokens = [e["token"] for e in events if not e["done"]]
    assert "".join(tokens) == "Hello from Qwen."


async def test_chat_stream_llm_failure_emits_fallback(
    patched_app: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.v1 import chat as chat_module
    from app.chatbot.prompts import FALLBACK_MESSAGE

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _failing_gemini_stream)

    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/chat/stream", json={"query": "anything"})
    assert resp.status_code == 200
    events = _parse_sse(resp.content)
    tokens = [e["token"] for e in events if not e["done"] and e["token"]]
    assert FALLBACK_MESSAGE in "".join(tokens)


async def test_chat_stream_validates_empty_query(patched_app: object) -> None:
    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/chat/stream", json={"query": ""})
    assert resp.status_code == 422
