"""SSE chat endpoint — POST /api/v1/chat/stream.

Body: {"query": str, "exercise"?: str, "frame"?: str (base64 JPEG),
       "history"?: [{"role": "user"|"assistant", "content": str}, ...]}
Stream format:
  - ``data: {"type": "status", "status": "thinking"}\\n\\n``   — before LLM call
  - ``data: {"type": "meta", "source_mode": "..."}\\n\\n``     — how the answer is grounded
  - ``data: {"token": "...", "done": false}\\n\\n``            — per streamed chunk
  - ``data: {"token": "", "done": true}\\n\\n``                — stream end

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
from app.chatbot.prompts import (
    CONVERSATIONAL_SYSTEM_PROMPT,
    SAFETY_NOTE,
    build_smart_fallback,
    build_sources_footer,
    build_user_prompt,
    is_safety_sensitive,
)
from app.metrics import chat_requests_total
from app.rate_limit import CHAT_RATE_LIMIT, limiter

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# ---------------------------------------------------------------------------
# Conversational intent classifier
# ---------------------------------------------------------------------------

_CONVERSATIONAL_EXACT: frozenset[str] = frozenset(
    {
        "hi", "hello", "hey", "sup", "yo", "howdy", "hola",
        "what's up", "whats up", "wassup",
        "good morning", "good evening", "good afternoon", "gm",
        "thanks", "thank you", "thx", "ty", "cheers",
        "bye", "goodbye", "see ya", "later", "cya",
        "who are you", "what are you", "what can you do",
        "help", "how are you", "how's it going",
    }
)

_CONVERSATIONAL_PREFIXES: tuple[str, ...] = (
    "hi ", "hello ", "hey ", "thanks ", "thank you ",
    "good morning ", "good evening ",
)

# Max word count to consider for conversational classification — longer queries
# are likely real questions even if they start with "hey".
_CONVERSATIONAL_MAX_WORDS = 8


def _is_conversational(query: str) -> bool:
    """True if the query is small-talk that should skip RAG/web search."""
    normalized = query.lower().strip().rstrip("?!.,")
    if normalized in _CONVERSATIONAL_EXACT:
        return True
    if len(normalized.split()) > _CONVERSATIONAL_MAX_WORDS:
        return False
    return normalized.startswith(_CONVERSATIONAL_PREFIXES)


# ---------------------------------------------------------------------------
# Request / SSE helpers
# ---------------------------------------------------------------------------

class HistoryMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    exercise: str | None = Field(default=None, max_length=32)
    frame: str | None = Field(default=None, description="Base64 JPEG snapshot (optional)")
    history: list[HistoryMessage] | None = Field(
        default=None,
        max_length=10,
        description="Previous conversation turns for multi-turn context",
    )


def _sse_event(token: str, done: bool = False) -> str:
    return f"data: {json.dumps({'token': token, 'done': done})}\n\n"


def _sse_status(status: str) -> str:
    """Emit a status event (e.g. 'thinking') for the frontend indicator."""
    return f"data: {json.dumps({'type': 'status', 'status': status})}\n\n"


def _sse_meta(source_mode: str) -> str:
    """Emit metadata about how the answer is grounded."""
    return f"data: {json.dumps({'type': 'meta', 'source_mode': source_mode})}\n\n"


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

    # No web fallback available: use weak KB chunks only if marginally on-topic,
    # else answer from general knowledge (no misleading citations).
    if rag.is_usable(scored):
        return [c.text for c in scored], [_cite_chunk(c) for c in scored], "rag"
    return [], [], "none"


def _history_dicts(history: list[HistoryMessage] | None) -> list[dict[str, str]] | None:
    """Convert pydantic models to plain dicts, capped at last 6 messages."""
    if not history:
        return None
    trimmed = history[-6:]
    return [{"role": m.role, "content": m.content} for m in trimmed]


async def _stream_tokens(request: Request, payload: ChatRequest) -> AsyncIterator[str]:
    has_frame = bool(payload.frame)
    provider = chat_router.route(payload.query, has_frame=has_frame)
    chat_requests_total.labels(provider=provider).inc()
    history = _history_dicts(payload.history)

    # --- Conversational shortcut: skip RAG / web for greetings & small-talk ---
    conversational = _is_conversational(payload.query) and not has_frame

    if conversational:
        source_mode = "conversational"
        context_chunks: list[str] = []
        citations: list[str] = []
        # Use the lightweight conversational prompt (no RAG context)
        prompt = payload.query  # raw query — the CONVERSATIONAL_SYSTEM_PROMPT handles tone
    else:
        # Confidence-gated RAG with live web fallback — best-effort, never blocks chat.
        context_chunks, citations, source_mode = await _gather_context(payload.query)
        prompt = build_user_prompt(
            payload.query, context_chunks,
            exercise=payload.exercise, history=history,
        )

    logger.info(
        "chat_request",
        provider=provider,
        has_frame=has_frame,
        source_mode=source_mode,
        chunks=len(context_chunks),
        exercise=payload.exercise,
        query_len=len(payload.query),
        history_turns=len(history) if history else 0,
    )

    # Emit status + meta events before the LLM starts streaming
    yield _sse_status("thinking")
    yield _sse_meta(source_mode)

    emitted_any = False
    try:
        if provider == "qwen":
            async for token in qwen_client.stream_chat(
                prompt,
                frame_b64=payload.frame,
                history=history,
                system_prompt_override=(
                    CONVERSATIONAL_SYSTEM_PROMPT if conversational else None
                ) if conversational else None,
            ):
                emitted_any = True
                yield _sse_event(token)
        else:
            executor = request.app.state.executor
            async for token in gemini_client.stream_chat(
                prompt,
                executor=executor,
                history=history,
                system_prompt_override=(
                    CONVERSATIONAL_SYSTEM_PROMPT if conversational else None
                ),
            ):
                emitted_any = True
                yield _sse_event(token)
        # Streamed cleanly — append the citations that grounded the answer.
        footer = build_sources_footer(citations)
        if footer:
            yield _sse_event(footer)
        # Injury / supplement questions get a brief educational-safety note.
        if is_safety_sensitive(payload.query):
            yield _sse_event(SAFETY_NOTE)
    except Exception as exc:  # noqa: BLE001 — never crash the SSE stream
        logger.error("chat_stream_failed", provider=provider, error=str(exc))
        if not emitted_any:
            smart_fb = build_smart_fallback(
                payload.query, context_chunks, exercise=payload.exercise
            )
            yield _sse_event(smart_fb)
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
