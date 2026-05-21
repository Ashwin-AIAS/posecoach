"""Async streaming wrapper around Gemini 2.0 Flash.

google-generativeai's ``generate_content`` is synchronous and returns a generator
when ``stream=True``. We run it in the FastAPI executor so the event loop stays
responsive, and yield tokens through an asyncio.Queue.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from concurrent.futures import Executor
from typing import Any

import structlog

from app.chatbot.prompts import SYSTEM_PROMPT

logger = structlog.get_logger(__name__)

MODEL_NAME = "gemini-2.0-flash"


def _configure_once() -> None:
    """Configure the Gemini SDK with the API key from the environment."""
    import google.generativeai as genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    genai.configure(api_key=api_key)


def _build_model() -> Any:
    import google.generativeai as genai

    _configure_once()
    return genai.GenerativeModel(model_name=MODEL_NAME, system_instruction=SYSTEM_PROMPT)


async def stream_chat(
    prompt: str,
    executor: Executor,
) -> AsyncIterator[str]:
    """Stream text tokens from Gemini 2.0 Flash."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    def _produce() -> None:
        try:
            model = _build_model()
            response = model.generate_content(prompt, stream=True)
            for chunk in response:
                text = getattr(chunk, "text", None)
                if text:
                    loop.call_soon_threadsafe(queue.put_nowait, text)
        except Exception as exc:  # noqa: BLE001
            logger.error("gemini_stream_failed", error=str(exc))
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
