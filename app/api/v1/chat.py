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

from app.chatbot import gemini_client, qwen_client, rag, web_search
from app.chatbot import router as chat_router
from app.chatbot.prompts import FALLBACK_MESSAGE, build_sources_footer, build_user_prompt
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


def _cite_chunk(chunk: rag.RetrievedChunk) -> str:
    """Citation string for a KB chunk: 'Title (url)' or just the title."""
    return f"{chunk.title} ({chunk.url})" if chunk.url else chunk.title


def _cite_web(result: web_search.WebResult) -> str:
    return f"{result.title} ({result.url})" if result.url else result.title


async def _gather_context(query: str) -> tuple[list[str], list[str], str]:
    """Confidence-gated retrieval with a live web fallback.

    Returns ``(context_chunks, citations, source_mode)`` where source_mode is
    "rag", "web", or "none". If the KB match is confident, use it; otherwise try
    a live web search; if that is unavailable, fall back to any weak KB chunks.
    """
    scored = rag.retrieve_scored(query, top_k=3)
    if rag.is_confident(scored):
        return [c.text for c in scored], [_cite_chunk(c) for c in scored], "rag"

    web = await web_search.search(query, k=4)
    if web:
        context = [f"{r.title}\n{r.snippet}".strip() for r in web]
        return context, [_cite_web(r) for r in web], "web"

    if scored:  # weak but better than nothing
        return [c.text for c in scored], [_cite_chunk(c) for c in scored], "rag"
    return [], [], "none"


async def _stream_tokens(request: Request, payload: ChatRequest) -> AsyncIterator[str]:
    has_frame = bool(payload.frame)
    provider = chat_router.route(payload.query, has_frame=has_frame)
    chat_requests_total.labels(provider=provider).inc()

    # Confidence-gated RAG with live web fallback — best-effort, never blocks chat.
    context_chunks, citations, source_mode = await _gather_context(payload.query)
    prompt = build_user_prompt(payload.query, context_chunks, exercise=payload.exercise)

    logger.info(
        "chat_request",
        provider=provider,
        has_frame=has_frame,
        source_mode=source_mode,
        chunks=len(context_chunks),
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
        # Streamed cleanly — append the citations that grounded the answer.
        footer = build_sources_footer(citations)
        if footer:
            yield _sse_event(footer)
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
