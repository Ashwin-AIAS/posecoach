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
import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Coroutine
from typing import Any

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.chatbot import answer_cache, gemini_client, qwen_client, rag, web_search
from app.chatbot import router as chat_router
from app.chatbot.prompts import (
    CONVERSATIONAL_SYSTEM_PROMPT,
    SAFETY_NOTE,
    SYSTEM_PROMPT,
    VISUAL_SYSTEM_PROMPT,
    build_persona_system_prompt,
    build_smart_fallback,
    build_sources_footer,
    build_user_prompt,
    is_safety_sensitive,
)
from app.metrics import chat_requests_total
from app.rate_limit import CHAT_RATE_LIMIT, limiter
from app.voice.personas import PersonaKey

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


# Strong references to fire-and-forget background tasks (cache writes). Without
# this the event loop may garbage-collect a pending task mid-flight.
_background_tasks: set[asyncio.Task[None]] = set()


def _spawn(coro: Coroutine[Any, Any, None]) -> None:
    """Run a best-effort coroutine off the critical path (never awaited)."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _is_conversational(query: str) -> bool:
    """True if the query is small-talk that should skip RAG/web search."""
    normalized = query.lower().strip().rstrip("?!.,")
    if normalized in _CONVERSATIONAL_EXACT:
        return True
    if len(normalized.split()) > _CONVERSATIONAL_MAX_WORDS:
        return False
    return normalized.startswith(_CONVERSATIONAL_PREFIXES)


# ---------------------------------------------------------------------------
# Speculative web-search heuristic (P35 finding #5)
# ---------------------------------------------------------------------------
# In the not-confident path the request pays retrieval *then* up to 2 s of web
# search before token one. Launching the search concurrently with retrieval
# hides that latency — but a speculative call that turns out unnecessary is a
# wasted (paid) request, so it only fires when a cheap signal says the KB is
# unlikely to answer. Two signals, deliberately conservative:
#
#   1. Recency / consumer intent — the curated KB is evergreen technique and
#      exercise-science content and can never answer these.
#   2. No in-domain vocabulary at all — a question with none of the words the
#      KB is written about ("what's the capital of France") will miss it.
#
# A confident KB hit cancels the task before its result is ever used.
_RECENCY_TERMS: frozenset[str] = frozenset(
    {
        "latest", "newest", "current", "currently", "today", "recent", "recently",
        "news", "released", "upcoming", "2024", "2025", "2026", "2027",
        "price", "prices", "cost", "cheapest", "buy", "review", "reviews",
        "brand", "brands", "record", "champion", "won",
    }
)

# Vocabulary the ingested knowledge base actually covers (technique, injury,
# supplements, nutrition, programming, recovery, sports science, posing).
_KB_DOMAIN_TERMS: frozenset[str] = frozenset(
    {
        # movements & equipment
        "squat", "squats", "deadlift", "deadlifts", "bench", "press", "curl", "curls",
        "ohp", "overhead", "lunge", "lunges", "plank", "row", "rows", "pullup", "pullups",
        "chinup", "pushup", "pushups", "barbell", "dumbbell", "kettlebell", "machine",
        "bar", "grip", "stance", "rack", "belt", "shoes", "cable",
        # anatomy
        "knee", "knees", "hip", "hips", "back", "spine", "shoulder", "shoulders",
        "elbow", "wrist", "ankle", "core", "glute", "glutes", "hamstring", "hamstrings",
        "quad", "quads", "lat", "lats", "chest", "bicep", "biceps", "tricep", "triceps",
        "joint", "tendon", "muscle", "muscles",
        # form & training
        "form", "technique", "depth", "rom", "range", "tempo", "rep", "reps", "set",
        "sets", "volume", "intensity", "load", "weight", "lift", "lifting", "warmup",
        "warm", "stretch", "mobility", "posture", "brace", "bracing", "breathing",
        "program", "programming", "routine", "split", "periodization", "progression",
        "overload", "plateau", "deload", "rpe", "1rm", "strength", "hypertrophy",
        "cardio", "conditioning", "training", "workout", "gym", "exercise", "exercises",
        # recovery / nutrition / health
        "recovery", "rest", "sleep", "soreness", "doms", "fatigue", "injury", "injuries",
        "pain", "hurt", "hurts", "sore", "strain", "sprain", "rehab", "prehab",
        "protein", "carbs", "carbohydrate", "fat", "calorie", "calories", "macro",
        "macros", "diet", "nutrition", "hydration", "creatine", "supplement",
        "supplements", "caffeine", "cutting", "bulking", "deficit", "surplus",
        # posing / physique
        "posing", "pose", "physique", "symmetry", "mandatory", "quarter", "turns",
        "bodybuilding", "contest", "prep", "division", "classic",
    }
)


def _should_speculate_web(query: str) -> bool:
    """True if a web fallback is likely needed, so it can start during retrieval.

    Wrong-way costs are asymmetric — a false positive is one wasted search call,
    a false negative just means today's serial behaviour — so the signals stay
    narrow. Returns False when no provider key is configured (nothing to gain).
    """
    if not web_search.is_available():
        return False
    words = {w.strip(".,!?;:'\"") for w in query.lower().split()}
    if words & _RECENCY_TERMS:
        return True
    return not (words & _KB_DOMAIN_TERMS)


async def _cancel_task(task: asyncio.Task[list[web_search.WebResult]] | None) -> None:
    """Cancel a speculative task and await it so nothing is left pending."""
    if task is None:
        return
    if task.done():
        task.exception()  # retrieve so asyncio does not log it as never-retrieved
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


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
    persona: PersonaKey | None = Field(
        default=None,
        description=(
            "Selected voice-coach persona (P29) — shared state with the cue lane. "
            "Shapes tone only via a system-prompt fragment; never alters retrieved "
            "facts or safety behaviour."
        ),
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


async def _gather_context(query: str, request: Request) -> tuple[list[str], list[str], str]:
    """Confidence-gated retrieval with a live web fallback.

    Returns ``(context_chunks, citations, source_mode)`` where source_mode is
    "rag", "web", or "none". If the KB match is confident, use it; otherwise try
    a live web search; if that is unavailable, fall back to any weak KB chunks.

    Uses Redis to cache RAG results (24-hour TTL) so repeated / common queries
    skip the embedding + ChromaDB round-trip entirely.  Embedding and vector
    search run in the app's thread-pool executor to avoid blocking the event loop.
    """
    redis_client = getattr(request.app.state, "redis", None)
    executor = request.app.state.executor
    # Shared pooled client (set in the app lifespan); None outside a full app.
    http_client = getattr(request.app.state, "http", None)

    # --- Fast path: Redis cache hit ---
    if redis_client is not None:
        cached = await rag.get_cached_chunks(redis_client, query)
        if cached is not None:
            if rag.is_confident(cached):
                return [c.text for c in cached], [_cite_chunk(c) for c in cached], "rag"
            # Cached but not confident — still try web, then usable check below.
            if rag.is_usable(cached):
                # Attempt web first; if unavailable, use these weak chunks.
                web = await web_search.search(query, k=4, client=http_client)
                if web:
                    context = [f"{r.title}\n{r.snippet}".strip() for r in web]
                    return context, [_cite_web(r) for r in web], "web"
                return [c.text for c in cached], [_cite_chunk(c) for c in cached], "rag"

    # --- Slow path: embed + ChromaDB (offloaded to thread pool) ---
    # Overlap the (likely) web fallback with retrieval instead of paying them
    # back-to-back. Cancelled below the moment the KB comes back confident.
    speculative: asyncio.Task[list[web_search.WebResult]] | None = None
    if _should_speculate_web(query):
        speculative = asyncio.create_task(web_search.search(query, k=4, client=http_client))

    scored = await rag.retrieve_scored_async(query, executor, top_k=3)

    # Cache the result for next time (best-effort, off the critical path — the
    # answer must never wait on a Redis write).
    if redis_client is not None and scored:
        _spawn(rag.set_cached_chunks(redis_client, query, scored))

    if rag.is_confident(scored):
        await _cancel_task(speculative)
        return [c.text for c in scored], [_cite_chunk(c) for c in scored], "rag"

    web = (
        await speculative
        if speculative is not None
        else await web_search.search(query, k=4, client=http_client)
    )
    if web:
        context = [f"{r.title}\n{r.snippet}".strip() for r in web]
        return context, [_cite_web(r) for r in web], "web"

    # No web fallback available: use weak KB chunks only if marginally on-topic,
    # else answer from general knowledge (no misleading citations).
    if rag.is_usable(scored):
        return [c.text for c in scored], [_cite_chunk(c) for c in scored], "rag"
    return [], [], "none"


# Replayed answers are chopped into small pieces so a cache hit still renders
# progressively in the UI instead of landing as one wall of text.
_REPLAY_CHUNK_CHARS = 160


def _replay_chunks(text: str) -> list[str]:
    """Split a cached answer into SSE-sized pieces (order/content preserved)."""
    return [text[i : i + _REPLAY_CHUNK_CHARS] for i in range(0, len(text), _REPLAY_CHUNK_CHARS)]


def _is_cacheable(payload: ChatRequest, conversational: bool) -> bool:
    """True if this turn may be served from / written to the answer cache.

    Personalized turns are excluded outright: a frame is user imagery, history
    is that user's conversation, small talk should stay varied, and a selected
    persona changes the answer's *text* (its tone), so a persona-flavoured
    reply must never be replayed to a different user who picked (or has) no
    persona. What is left is a plain, persona-less question keyed only by
    (query, exercise) — safe to share.
    """
    return (
        not payload.frame
        and not payload.history
        and not conversational
        and payload.persona is None
    )


def _persona_system_prompt(
    *, conversational: bool, has_frame: bool, persona: PersonaKey | None
) -> str | None:
    """The ``system_prompt_override`` sent to both LLM clients (P29 S7).

    With no persona selected this reproduces the exact pre-P29 behaviour:
    conversational turns get ``CONVERSATIONAL_SYSTEM_PROMPT`` explicitly,
    everything else passes ``None`` so each client applies its own default
    (``SYSTEM_PROMPT`` for Gemini; ``VISUAL_SYSTEM_PROMPT``-if-framed else
    ``SYSTEM_PROMPT`` for Qwen) — existing chatbot tests exercise only this
    path and are unaffected. A selected persona always sets an explicit
    override (its tone fragment layered on the right base prompt) so it
    applies regardless of provider or whether a frame is attached.
    """
    if persona is None:
        return CONVERSATIONAL_SYSTEM_PROMPT if conversational else None
    if conversational:
        base = CONVERSATIONAL_SYSTEM_PROMPT
    elif has_frame:
        base = VISUAL_SYSTEM_PROMPT
    else:
        base = SYSTEM_PROMPT
    return build_persona_system_prompt(base, persona)


def _history_dicts(history: list[HistoryMessage] | None) -> list[dict[str, str]] | None:
    """Convert pydantic models to plain dicts, capped at last 6 messages."""
    if not history:
        return None
    trimmed = history[-6:]
    return [{"role": m.role, "content": m.content} for m in trimmed]


async def _stream_tokens(request: Request, payload: ChatRequest) -> AsyncIterator[str]:
    # The status event is the FIRST thing on the wire — before any await. It
    # used to be emitted after _gather_context(), so the client sat blank
    # through embedding + ChromaDB + (worst case) a 2 s web-search round-trip
    # even though the server was already working. Nothing below may move above
    # this line.
    yield _sse_status("thinking")

    has_frame = bool(payload.frame)
    provider = chat_router.route(payload.query, has_frame=has_frame)
    chat_requests_total.labels(provider=provider).inc()
    history = _history_dicts(payload.history)

    # --- Conversational shortcut: skip RAG / web for greetings & small-talk ---
    conversational = _is_conversational(payload.query) and not has_frame

    # --- Answer cache: replay an identical, non-personalized turn ---
    redis_client = getattr(request.app.state, "redis", None)
    cacheable = _is_cacheable(payload, conversational)
    if cacheable and redis_client is not None:
        cached_answer = await answer_cache.load(redis_client, payload.query, payload.exercise)
        if cached_answer is not None:
            logger.info(
                "chat_request",
                provider=provider,
                source_mode=cached_answer.source_mode,
                cached=True,
                exercise=payload.exercise,
                query_len=len(payload.query),
            )
            yield _sse_meta(cached_answer.source_mode)
            for part in _replay_chunks(cached_answer.text):
                yield _sse_event(part)
            yield _sse_event("", done=True)
            return

    if conversational:
        source_mode = "conversational"
        context_chunks: list[str] = []
        citations: list[str] = []
        # Use the lightweight conversational prompt (no RAG context)
        prompt = payload.query  # raw query — the CONVERSATIONAL_SYSTEM_PROMPT handles tone
    else:
        # Confidence-gated RAG with live web fallback — best-effort, never blocks chat.
        context_chunks, citations, source_mode = await _gather_context(payload.query, request)
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
        persona=payload.persona,
    )

    # How the answer is grounded — known only once retrieval has settled.
    yield _sse_meta(source_mode)

    system_prompt_override = _persona_system_prompt(
        conversational=conversational, has_frame=has_frame, persona=payload.persona
    )

    emitted_any = False
    # Everything the client receives for this answer, so a cache replay is
    # byte-identical — citations footer and safety note included.
    answer_parts: list[str] = []
    try:
        if provider == "qwen":
            async for token in qwen_client.stream_chat(
                prompt,
                frame_b64=payload.frame,
                history=history,
                system_prompt_override=system_prompt_override,
            ):
                emitted_any = True
                answer_parts.append(token)
                yield _sse_event(token)
        else:
            executor = request.app.state.executor
            async for token in gemini_client.stream_chat(
                prompt,
                executor=executor,
                history=history,
                system_prompt_override=system_prompt_override,
            ):
                emitted_any = True
                answer_parts.append(token)
                yield _sse_event(token)
        # Streamed cleanly — append the citations that grounded the answer.
        footer = build_sources_footer(citations)
        if footer:
            answer_parts.append(footer)
            yield _sse_event(footer)
        # Injury / supplement questions get a brief educational-safety note.
        if is_safety_sensitive(payload.query):
            answer_parts.append(SAFETY_NOTE)
            yield _sse_event(SAFETY_NOTE)
        # Only a complete, cleanly-streamed answer is worth replaying.
        if cacheable and redis_client is not None and emitted_any:
            _spawn(
                answer_cache.store(
                    redis_client,
                    payload.query,
                    payload.exercise,
                    answer_cache.CachedAnswer(
                        text="".join(answer_parts), source_mode=source_mode
                    ),
                )
            )
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
