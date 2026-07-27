"""Async streaming wrapper around Gemini via the unified Google Gen AI SDK.

The new ``google-genai`` SDK exposes a synchronous streaming generator through
``client.models.generate_content_stream``. We run it in the FastAPI executor so
the event loop stays responsive, and yield tokens through an asyncio.Queue —
identical concurrency model to the old ``google-generativeai`` client.

Model name is env-configurable via ``GEMINI_MODEL`` so future Google model
retirements (e.g. the June 2026 gemini-2.0-flash shutdown) need only an env
change, not a code change.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from concurrent.futures import Executor
from functools import lru_cache
from typing import Any

import structlog

from app.chatbot.prompts import SYSTEM_PROMPT

logger = structlog.get_logger(__name__)

# gemini-2.0-flash was retired 2026-06-01; gemini-3.5-flash has no announced
# shutdown date. Override with GEMINI_MODEL if Google retires this one too.
MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")


class _GeminiStreamer:
    """Adapter exposing a ``generate_content(prompt, stream=True)`` generator.

    Keeps a stable seam for unit tests (which patch ``_build_model``) while the
    underlying call uses the new google-genai client.
    """

    def __init__(self, client: Any, model_name: str) -> None:
        self._client = client
        self._model = model_name

    def generate_content(
        self,
        prompt: str,
        stream: bool = True,
        history: list[dict[str, str]] | None = None,
        system_prompt: str | None = None,
    ) -> Any:
        from google.genai import types

        sys_instruction = system_prompt or SYSTEM_PROMPT

        # Build multi-turn contents if history is provided
        if history:
            contents: list[dict[str, Any]] = []
            for turn in history:
                role = "user" if turn["role"] == "user" else "model"
                contents.append({"role": role, "parts": [{"text": turn["content"]}]})
            # Current prompt as the final user turn
            contents.append({"role": "user", "parts": [{"text": prompt}]})
        else:
            contents = prompt  # type: ignore[assignment]

        return self._client.models.generate_content_stream(
            model=self._model,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=sys_instruction),
        )


@lru_cache(maxsize=1)
def _get_genai_client() -> Any:
    """Process-wide ``genai.Client`` singleton (same pattern as ``_get_embedder``).

    Building a client per request re-ran SDK setup (and its underlying HTTP
    client) on every chat call; the client is stateless across requests, so it
    is built lazily once and reused. Failures are not cached — ``lru_cache``
    only stores successful returns — so a late-set API key still works.

    Raises:
        RuntimeError: If ``GEMINI_API_KEY`` is not set in the environment.
    """
    from google import genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    logger.info("gemini_client_created", model=MODEL_NAME)
    return genai.Client(api_key=api_key)


def _build_model() -> _GeminiStreamer:
    """Bind the cached client to the configured model.

    Kept as a cheap, patchable seam for the unit tests; the expensive part (the
    SDK client) lives in :func:`_get_genai_client`.

    Raises:
        RuntimeError: If ``GEMINI_API_KEY`` is not set in the environment.
    """
    return _GeminiStreamer(_get_genai_client(), MODEL_NAME)


async def stream_chat(
    prompt: str,
    executor: Executor,
    history: list[dict[str, str]] | None = None,
    system_prompt_override: str | None = None,
) -> AsyncIterator[str]:
    """Stream text tokens from Gemini via the executor."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    failure: dict[str, BaseException] = {}

    def _produce() -> None:
        try:
            model = _build_model()
            response = model.generate_content(
                prompt,
                stream=True,
                history=history,
                system_prompt=system_prompt_override,
            )
            for chunk in response:
                text = getattr(chunk, "text", None)
                if text:
                    loop.call_soon_threadsafe(queue.put_nowait, text)
        except Exception as exc:  # noqa: BLE001
            logger.error("gemini_stream_failed", model=MODEL_NAME, error=repr(exc))
            failure["exc"] = exc
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    task = loop.run_in_executor(executor, _produce)

    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
    finally:
        await task

    # Surface the failure so the caller can emit the fallback message instead of
    # ending the SSE stream silently. Without this, a Gemini error is swallowed
    # here and the user just sees an empty assistant reply.
    if "exc" in failure:
        raise failure["exc"]
