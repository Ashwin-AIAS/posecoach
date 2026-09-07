"""Persona prompt-fragment wiring into the chatbot (P29 S7).

A new file — deliberately not touching tests/test_chat_endpoint.py (or any
other existing chatbot test) so the pre-P29 regression suite stays
byte-for-byte unmodified, per the S7 gate. Mirrors that file's
``patched_app`` fixture pattern but captures the ``system_prompt_override``
each fake LLM stream received instead of asserting on streamed tokens.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient


class _Capture:
    """Records the last `system_prompt_override` a fake LLM client received."""

    def __init__(self) -> None:
        self.system_prompt_override: str | None = None


@pytest.fixture
def capture() -> _Capture:
    return _Capture()


@pytest.fixture
def patched_app(monkeypatch: pytest.MonkeyPatch, capture: _Capture) -> object:
    from app.api.v1 import chat as chat_module
    from app.main import app

    async def _fake_gemini_stream(
        prompt: str,
        executor: object,
        history: object = None,
        system_prompt_override: str | None = None,
    ) -> AsyncIterator[str]:
        capture.system_prompt_override = system_prompt_override
        yield "ok"

    async def _fake_qwen_stream(
        prompt: str,
        frame_b64: str | None = None,
        history: object = None,
        system_prompt_override: str | None = None,
    ) -> AsyncIterator[str]:
        capture.system_prompt_override = system_prompt_override
        yield "ok"

    async def _no_web(*args: Any, **kwargs: Any) -> list[object]:
        return []

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _fake_gemini_stream)
    monkeypatch.setattr(chat_module.qwen_client, "stream_chat", _fake_qwen_stream)
    monkeypatch.setattr(chat_module.rag, "retrieve_scored", lambda q, top_k=3: [])
    monkeypatch.setattr(chat_module.web_search, "search", _no_web)

    if not hasattr(app.state, "executor"):
        app.state.executor = ThreadPoolExecutor(max_workers=1)
    return app


async def _post(app: object, body: dict[str, object]) -> None:
    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/chat/stream", json=body)
    assert resp.status_code == 200


async def test_no_persona_text_query_keeps_pre_p29_override(
    patched_app: object, capture: _Capture
) -> None:
    """Regression: omitting `persona` must reproduce the exact prior behaviour."""
    await _post(patched_app, {"query": "how deep should I squat"})
    assert capture.system_prompt_override is None


async def test_no_persona_conversational_keeps_pre_p29_override(
    patched_app: object, capture: _Capture
) -> None:
    from app.chatbot.prompts import CONVERSATIONAL_SYSTEM_PROMPT

    await _post(patched_app, {"query": "hello"})
    assert capture.system_prompt_override == CONVERSATIONAL_SYSTEM_PROMPT


async def test_persona_layers_tone_fragment_on_the_default_system_prompt(
    patched_app: object, capture: _Capture
) -> None:
    from app.chatbot.prompts import SYSTEM_PROMPT
    from app.voice.personas import PERSONAS

    await _post(patched_app, {"query": "how deep should I squat", "persona": "atlas"})

    assert capture.system_prompt_override is not None
    assert capture.system_prompt_override.startswith(SYSTEM_PROMPT)
    assert PERSONAS["atlas"].prompt_fragment in capture.system_prompt_override


async def test_persona_layers_on_the_conversational_prompt(
    patched_app: object, capture: _Capture
) -> None:
    from app.chatbot.prompts import CONVERSATIONAL_SYSTEM_PROMPT
    from app.voice.personas import PERSONAS

    await _post(patched_app, {"query": "hello", "persona": "forge"})

    assert capture.system_prompt_override is not None
    assert capture.system_prompt_override.startswith(CONVERSATIONAL_SYSTEM_PROMPT)
    assert PERSONAS["forge"].prompt_fragment in capture.system_prompt_override


async def test_persona_layers_on_the_visual_prompt_for_frame_queries(
    patched_app: object, capture: _Capture
) -> None:
    """A frame routes to Qwen; persona must still apply on top of VISUAL_SYSTEM_PROMPT."""
    from app.chatbot.prompts import VISUAL_SYSTEM_PROMPT
    from app.voice.personas import PERSONAS

    await _post(
        patched_app, {"query": "check my form", "frame": "fake_base64_jpeg", "persona": "vector"}
    )

    assert capture.system_prompt_override is not None
    assert capture.system_prompt_override.startswith(VISUAL_SYSTEM_PROMPT)
    assert PERSONAS["vector"].prompt_fragment in capture.system_prompt_override


async def test_persona_never_alters_the_safety_note(patched_app: object) -> None:
    """Spec §7: the persona fragment shapes tone only, never safety behaviour."""
    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/chat/stream",
            json={"query": "my knee hurts after squats", "persona": "atlas"},
        )
    assert resp.status_code == 200
    body = resp.content.decode("utf-8")
    assert "not medical advice" in body.lower()


async def test_invalid_persona_rejected_with_422(patched_app: object) -> None:
    transport = ASGITransport(app=patched_app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/chat/stream", json={"query": "hi", "persona": "batman"})
    assert resp.status_code == 422


def test_is_cacheable_excludes_persona_selected_turns() -> None:
    """A persona changes answer *text* — must never be shared via the answer cache."""
    from app.api.v1.chat import ChatRequest, _is_cacheable

    payload = ChatRequest(query="how deep should I squat", persona="atlas")
    assert _is_cacheable(payload, conversational=False) is False


def test_is_cacheable_allows_plain_turns_without_persona() -> None:
    from app.api.v1.chat import ChatRequest, _is_cacheable

    payload = ChatRequest(query="how deep should I squat")
    assert _is_cacheable(payload, conversational=False) is True


def test_build_persona_system_prompt_is_a_pure_addition() -> None:
    """No persona returns `base` byte-identical — never a lossy transform."""
    from app.chatbot.prompts import SYSTEM_PROMPT, build_persona_system_prompt

    assert build_persona_system_prompt(SYSTEM_PROMPT, None) == SYSTEM_PROMPT


def test_build_persona_system_prompt_never_drops_the_base_instructions() -> None:
    from app.chatbot.prompts import SYSTEM_PROMPT, build_persona_system_prompt

    result = build_persona_system_prompt(SYSTEM_PROMPT, "forge")
    assert SYSTEM_PROMPT in result
    assert len(result) > len(SYSTEM_PROMPT)
