"""Unit tests for the Gemini streaming client.

Regression cover for the silent-failure bug: a failure inside the executor
thread must PROPAGATE out of ``stream_chat`` so the SSE endpoint can emit the
fallback message — not be swallowed into an empty stream.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from app.chatbot import gemini_client


class _FakeChunk:
    def __init__(self, text: str) -> None:
        self.text = text


class _FakeModel:
    """Stand-in for genai.GenerativeModel with a scripted stream."""

    def __init__(self, texts: list[str]) -> None:
        self._texts = texts

    def generate_content(self, prompt: str, stream: bool = False) -> Any:
        return iter(_FakeChunk(t) for t in self._texts)


async def _collect(executor: ThreadPoolExecutor, prompt: str = "hi") -> list[str]:
    return [tok async for tok in gemini_client.stream_chat(prompt, executor=executor)]


async def test_stream_chat_yields_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        gemini_client, "_build_model", lambda: _FakeModel(["Squat ", "deep."])
    )
    with ThreadPoolExecutor(max_workers=1) as ex:
        tokens = await _collect(ex)
    assert "".join(tokens) == "Squat deep."


async def test_stream_chat_propagates_build_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """If model construction fails (e.g. missing API key), the error must surface."""

    def _boom() -> Any:
        raise RuntimeError("GEMINI_API_KEY is not set")

    monkeypatch.setattr(gemini_client, "_build_model", _boom)
    with ThreadPoolExecutor(max_workers=1) as ex:
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
            await _collect(ex)


async def test_stream_chat_propagates_midstream_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An error after some tokens still propagates once the stream drains."""

    class _BrokenModel:
        def generate_content(self, prompt: str, stream: bool = False) -> Any:
            yield _FakeChunk("partial ")
            raise RuntimeError("stream broke")

    monkeypatch.setattr(gemini_client, "_build_model", lambda: _BrokenModel())
    with ThreadPoolExecutor(max_workers=1) as ex:
        with pytest.raises(RuntimeError, match="stream broke"):
            await _collect(ex)
