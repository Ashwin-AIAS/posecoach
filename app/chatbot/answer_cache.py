"""Short-TTL Redis cache of *final* chat answers (P35 finding #6).

Retrieval results were already cached, but the LLM was still re-hit for
identical common questions ("how deep should I squat?"), paying the full
generation latency every time. This caches the finished answer text — including
its citation footer — keyed by the normalized query and exercise, and the chat
endpoint replays it as SSE tokens on a hit.

Safety rules baked into the key and the caller's gate:

* **Never personalized.** The key is (query, exercise) only. Turns carrying a
  ``frame``, a conversation ``history``, or the conversational shortcut are not
  cached at all, so one user's context can never be served to another.
* **Prompt-versioned.** The key embeds a digest of the system prompt, so editing
  the prompt invalidates every cached answer automatically — no manual bump.
* **Best-effort.** Every operation swallows its errors; a broken Redis degrades
  to "always a miss", never to a failed chat.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

import structlog

from app.chatbot.prompts import SYSTEM_PROMPT

if TYPE_CHECKING:
    import redis.asyncio as redis

logger = structlog.get_logger(__name__)

_PREFIX: Final[str] = "chat:answer:"
# Bumping the prompt must invalidate cached answers; deriving the version from
# the prompt itself means that can never be forgotten.
_PROMPT_VERSION: Final[str] = hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:8]

# KB-grounded and general-knowledge answers are stable — a long TTL is safe.
TTL_SECONDS: Final[int] = 21_600  # 6 hours
# Web-grounded answers cite live sources and go stale faster.
TTL_SECONDS_WEB: Final[int] = 3_600  # 1 hour

# Source modes worth caching. "conversational" is excluded by the caller (small
# talk is cheap and should stay varied).
CACHEABLE_MODES: Final[frozenset[str]] = frozenset({"rag", "web", "none"})


@dataclass(frozen=True)
class CachedAnswer:
    """A replayable answer: the full text (footer included) and its grounding."""

    text: str
    source_mode: str


def cache_key(query: str, exercise: str | None) -> str:
    """Deterministic Redis key for a normalized (query, exercise) pair."""
    normalized = " ".join(query.lower().split())
    material = f"{_PROMPT_VERSION}|{exercise or ''}|{normalized}"
    return f"{_PREFIX}{hashlib.sha256(material.encode()).hexdigest()[:20]}"


def ttl_for(source_mode: str) -> int:
    """TTL in seconds for an answer grounded via *source_mode*."""
    return TTL_SECONDS_WEB if source_mode == "web" else TTL_SECONDS


async def load(
    redis_client: redis.Redis,
    query: str,
    exercise: str | None,
) -> CachedAnswer | None:
    """Return a cached answer, or ``None`` on miss / malformed entry / error."""
    try:
        raw: Any = await redis_client.get(cache_key(query, exercise))
        if raw is None:
            return None
        data = json.loads(raw)
        text = str(data["text"])
        source_mode = str(data.get("source_mode", "none"))
        if not text:
            return None
        logger.info("chat_answer_cache_hit", exercise=exercise, source_mode=source_mode)
        return CachedAnswer(text=text, source_mode=source_mode)
    except Exception as exc:  # noqa: BLE001 — cache is best-effort
        logger.warning("chat_answer_cache_get_failed", error=str(exc))
        return None


async def store(
    redis_client: redis.Redis,
    query: str,
    exercise: str | None,
    answer: CachedAnswer,
) -> None:
    """Persist a finished answer with a mode-appropriate TTL (never throws)."""
    if not answer.text.strip() or answer.source_mode not in CACHEABLE_MODES:
        return
    try:
        payload = json.dumps({"text": answer.text, "source_mode": answer.source_mode})
        await redis_client.set(
            cache_key(query, exercise), payload, ex=ttl_for(answer.source_mode)
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat_answer_cache_set_failed", error=str(exc))
