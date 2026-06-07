"""Async streaming client for Qwen 2.5-VL via OpenRouter.

OpenRouter exposes an OpenAI-compatible chat completions endpoint with SSE
streaming. We use httpx.AsyncClient with ``stream=True``, parse ``data: ...``
lines, and yield content tokens.
"""
from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
import structlog

from app.chatbot.prompts import SYSTEM_PROMPT, VISUAL_SYSTEM_PROMPT

logger = structlog.get_logger(__name__)

MODEL_NAME = "qwen/qwen2.5-vl-72b-instruct"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
REQUEST_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)


def _build_messages(
    prompt: str,
    frame_b64: str | None,
    history: list[dict[str, str]] | None = None,
    system_prompt_override: str | None = None,
) -> list[dict[str, Any]]:
    """Build OpenAI-style messages, attaching the frame as an image_url if present."""
    if system_prompt_override:
        system = system_prompt_override
    elif frame_b64:
        system = VISUAL_SYSTEM_PROMPT
    else:
        system = SYSTEM_PROMPT

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]

    # Insert multi-turn history between system and current user message
    if history:
        for turn in history:
            messages.append({
                "role": turn["role"],
                "content": [{"type": "text", "text": turn["content"]}],
            })

    if frame_b64:
        user_content: list[dict[str, Any]] = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
        ]
    else:
        user_content = [{"type": "text", "text": prompt}]

    messages.append({"role": "user", "content": user_content})
    return messages


async def stream_chat(
    prompt: str,
    frame_b64: str | None = None,
    history: list[dict[str, str]] | None = None,
    system_prompt_override: str | None = None,
) -> AsyncIterator[str]:
    """Stream text tokens from Qwen via OpenRouter."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")

    body = {
        "model": MODEL_NAME,
        "messages": _build_messages(prompt, frame_b64, history, system_prompt_override),
        "stream": True,
        "max_tokens": 600,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://posecoach.app",
        "X-Title": "PoseCoach",
    }

    async with (
        httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client,
        client.stream("POST", OPENROUTER_URL, headers=headers, json=body) as resp,
    ):
        if resp.status_code != 200:
            detail = await resp.aread()
            logger.error(
                "qwen_http_error",
                status=resp.status_code,
                body=detail[:200].decode("utf-8", "ignore"),
            )
            raise RuntimeError(f"OpenRouter returned {resp.status_code}")

        async for raw_line in resp.aiter_lines():
            if not raw_line or not raw_line.startswith("data: "):
                continue
            payload = raw_line[6:].strip()
            if payload == "[DONE]":
                return
            try:
                event = json.loads(payload)
            except json.JSONDecodeError:
                continue
            delta = event.get("choices", [{}])[0].get("delta", {}).get("content")
            if delta:
                yield delta
