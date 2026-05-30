"""SSE chat endpoint — POST /api/v1/chat/stream.

Body: {"query": str, "exercise"?: str, "frame"?: str (base64 JPEG)}
Stream format: ``data: {"token": "...", "done": false}\\n\\n`` per chunk,
terminated by ``data: {"token": "", "done": true}\\n\\n``.

Smart routing in ``router.route()`` decides Gemini vs Qwen per request.
On LLM failure, a single FALLBACK_MESSAGE event is emitted before completion.
"""
# NOTE: no `from __future__ import annotations` here — slowapi wraps the
# rate-limited @router.post("/stream") endpoint, and on the prod image's older
# FastAPI/pydantic, lazy string annotations fail to resolve through the wrapper.
import json
from collections.abc import AsyncIterator

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.chatbot import gemini_client, qwen_client, rag
from app.chatbot import router as chat_router
from app.chatbot.prompts import FALLBACK_MESSAGE, build_user_prompt
from app.metrics import chat_requests_total
from app.rate_limit import CHAT_RATE_LIMIT, limiter

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    exercise: str | None = Field(default=None, max_length=32)
    frame: str | None = Field(default=None, description="Base64 JPEG snapshot (optional)")


def _sse_event(token: str, done: bool = False) -> str:
    return f"data: {json.dumps({'token': token, 'done': done})}\n\n"


async def _stream_tokens(request: Request, payload: ChatRequest) -> AsyncIterator[str]:
    has_frame = bool(payload.frame)
    provider = chat_router.route(payload.query, has_frame=has_frame)
    chat_requests_total.labels(provider=provider).inc()

    # RAG retrieval — best-effort, never blocks chat
    chunks = rag.retrieve(payload.query, top_k=3)
    prompt = build_user_prompt(payload.query, chunks, exercise=payload.exercise)

    logger.info(
        "chat_request",
        provider=provider,
        has_frame=has_frame,
        chunks=len(chunks),
        exercise=payload.exercise,
        query_len=len(payload.query),
    )

    emitted_any = False
    try:
        if provider == "qwen":
            async for token in qwen_client.stream_chat(prompt, frame_b64=payload.frame):
                emitted_any = True
                yield _sse_event(token)
        else:
            executor = request.app.state.executor
            async for token in gemini_client.stream_chat(prompt, executor=executor):
                emitted_any = True
                yield _sse_event(token)
    except Exception as exc:  # noqa: BLE001 — never crash the SSE stream
        logger.error("chat_stream_failed", provider=provider, error=str(exc))
        if not emitted_any:
            yield _sse_event(FALLBACK_MESSAGE)
    finally:
        yield _sse_event("", done=True)


@router.post("/stream")
@limiter.limit(CHAT_RATE_LIMIT)
async def chat_stream(request: Request, payload: ChatRequest) -> StreamingResponse:
    """Stream a coaching answer back as SSE."""
    return StreamingResponse(
        _stream_tokens(request, payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering (NGINX)
            "Connection": "keep-alive",
        },
    )
