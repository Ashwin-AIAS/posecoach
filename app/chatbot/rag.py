"""ChromaDB-backed retrieval for the coaching chatbot.

The collection is populated by ``app.chatbot.ingest`` from markdown files in
``data/knowledge_base/``. At query time the user question is embedded with the
same sentence-transformers model and the top-K chunks are returned.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from concurrent.futures import Executor
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import TYPE_CHECKING, Any

import numpy as np
import numpy.typing as npt
import structlog

if TYPE_CHECKING:
    import redis.asyncio as redis
    from chromadb.api.models.Collection import Collection
    from sentence_transformers import SentenceTransformer

logger = structlog.get_logger(__name__)

COLLECTION_NAME = "posecoach_knowledge"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_TOP_K = 3
# Cosine distance above which the best hit is too weak to trust. Measured on the
# ingested KB: in-domain questions top out around 0.53, off-topic ones sit above
# 0.84, so 0.60 cleanly separates "answer from the KB" from "fall back to web".
RETRIEVAL_DISTANCE_THRESHOLD = 0.60
# Beyond this, the chunks are off-topic (e.g. "capital of France" ~0.88): when no
# web fallback is available, citing them would mislead, so we use no context.
RETRIEVAL_IRRELEVANT_DISTANCE = 0.75

# Redis cache TTL for RAG query results (24 hours).
_CACHE_TTL_SECONDS = 86400
_CACHE_PREFIX = "rag:query:"


@dataclass(frozen=True)
class RetrievedChunk:
    """One retrieved KB chunk with its citation metadata and similarity distance."""

    text: str
    source: str
    title: str
    url: str
    distance: float


# ---------------------------------------------------------------------------
# Singleton loaders (unchanged — still used by ingest and sync callers)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_embedder() -> SentenceTransformer:
    from sentence_transformers import SentenceTransformer

    logger.info("loading_embedder", model=EMBEDDING_MODEL)
    return SentenceTransformer(EMBEDDING_MODEL)


@lru_cache(maxsize=1)
def _get_collection() -> Collection:
    import chromadb

    chroma_path = os.environ.get("CHROMA_PATH", "data/chroma")
    client = chromadb.PersistentClient(path=chroma_path)
    return client.get_or_create_collection(name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"})


# Memoized "the collection has documents" flag. ``count()`` was an extra Chroma
# round-trip on *every* retrieval; a populated index never empties inside a
# running process, so a True result is cached for the process lifetime. A False
# result is deliberately NOT cached — at startup the index may still be building
# in the background, and the next query must see it once it lands.
_COLLECTION_POPULATED = False


def _collection_has_docs(collection: Collection) -> bool:
    """True if the KB collection holds any chunks (count memoized once true)."""
    global _COLLECTION_POPULATED
    if _COLLECTION_POPULATED:
        return True
    if collection.count() > 0:
        _COLLECTION_POPULATED = True
        return True
    return False


def reset_collection_state() -> None:
    """Forget the memoized populated-flag — call after an ingest or a reset."""
    global _COLLECTION_POPULATED
    _COLLECTION_POPULATED = False


# ---------------------------------------------------------------------------
# Core embedding / retrieval (sync — kept for backward compat & ingest)
# ---------------------------------------------------------------------------

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts with the cached SentenceTransformer."""
    embedder = _get_embedder()
    vectors = embedder.encode(texts, show_progress_bar=False, convert_to_numpy=True)
    return [v.tolist() for v in vectors]


def retrieve(query: str, top_k: int = DEFAULT_TOP_K) -> list[str]:
    """Return up to ``top_k`` relevant knowledge chunks for ``query``.

    Returns an empty list if the collection is empty or any error occurs.
    """
    if not query.strip():
        return []

    try:
        collection = _get_collection()
        if not _collection_has_docs(collection):
            logger.warning("rag_collection_empty")
            return []
        query_embedding = embed_texts([query])[0]
        embeddings: npt.NDArray[np.float32] = np.asarray([query_embedding], dtype=np.float32)
        result = collection.query(query_embeddings=embeddings, n_results=top_k)
        documents = result.get("documents", [[]])
        chunks: list[str] = list(documents[0]) if documents else []
        logger.info("rag_retrieved", query_len=len(query), chunks=len(chunks))
        return chunks
    except Exception as exc:  # noqa: BLE001 — RAG is best-effort; never break chat
        logger.error("rag_retrieve_failed", error=str(exc))
        return []


def retrieve_scored(query: str, top_k: int = DEFAULT_TOP_K) -> list[RetrievedChunk]:
    """Retrieve chunks with citation metadata and cosine distance for gating.

    Returns an empty list if the collection is empty, the query is blank, or any
    error occurs — the caller treats an empty result as "no confident match".
    """
    if not query.strip():
        return []
    try:
        collection = _get_collection()
        if not _collection_has_docs(collection):
            logger.warning("rag_collection_empty")
            return []
        query_embedding = embed_texts([query])[0]
        embeddings: npt.NDArray[np.float32] = np.asarray([query_embedding], dtype=np.float32)
        # Default include already returns documents, metadatas, and distances.
        result = collection.query(query_embeddings=embeddings, n_results=top_k)
        docs = (result.get("documents") or [[]])[0]
        metas = (result.get("metadatas") or [[]])[0] or [{} for _ in docs]
        dists = (result.get("distances") or [[]])[0] or [0.0 for _ in docs]
        out: list[RetrievedChunk] = []
        for doc, meta, dist in zip(docs, metas, dists, strict=False):
            m = meta or {}
            source = str(m.get("source", ""))
            out.append(
                RetrievedChunk(
                    text=str(doc),
                    source=source,
                    title=str(m.get("title") or source or "Knowledge base"),
                    url=str(m.get("url", "")),
                    distance=float(dist),
                )
            )
        logger.info("rag_retrieved_scored", chunks=len(out), best=out[0].distance if out else None)
        return out
    except Exception as exc:  # noqa: BLE001 — best-effort; never break chat
        logger.error("rag_retrieve_scored_failed", error=str(exc))
        return []


# ---------------------------------------------------------------------------
# Confidence / usability gates (unchanged)
# ---------------------------------------------------------------------------

def is_confident(chunks: list[RetrievedChunk]) -> bool:
    """True if the best retrieved chunk is within the trust distance threshold."""
    return bool(chunks) and min(c.distance for c in chunks) <= RETRIEVAL_DISTANCE_THRESHOLD


def is_usable(chunks: list[RetrievedChunk]) -> bool:
    """True if chunks are at least marginally on-topic (web-fallback last resort).

    Used only when a live web search is unavailable: marginal chunks are better
    than nothing, but clearly off-topic ones would produce misleading citations.
    """
    return bool(chunks) and min(c.distance for c in chunks) <= RETRIEVAL_IRRELEVANT_DISTANCE


# ---------------------------------------------------------------------------
# Async thread-offloaded retrieval (new — avoids blocking the event loop)
# ---------------------------------------------------------------------------

async def retrieve_scored_async(
    query: str,
    executor: Executor,
    top_k: int = DEFAULT_TOP_K,
) -> list[RetrievedChunk]:
    """Non-blocking ``retrieve_scored`` — runs embedding + ChromaDB in *executor*.

    Drop-in async replacement: same return type, same error-resilience contract.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, retrieve_scored, query, top_k)


# ---------------------------------------------------------------------------
# Redis caching helpers
# ---------------------------------------------------------------------------

def _cache_key(query: str) -> str:
    """Deterministic Redis key for a normalised query string."""
    normalised = query.strip().lower()
    digest = hashlib.sha256(normalised.encode()).hexdigest()[:16]
    return f"{_CACHE_PREFIX}{digest}"


def _chunks_to_json(chunks: list[RetrievedChunk]) -> str:
    """Serialise retrieved chunks to a compact JSON string for Redis."""
    return json.dumps([asdict(c) for c in chunks])


def _chunks_from_json(raw: str) -> list[RetrievedChunk]:
    """Deserialise a JSON string back to a list of ``RetrievedChunk``."""
    return [RetrievedChunk(**d) for d in json.loads(raw)]


async def get_cached_chunks(
    redis_client: redis.Redis,
    query: str,
) -> list[RetrievedChunk] | None:
    """Return cached retrieval results, or ``None`` on miss / error."""
    try:
        raw: Any = await redis_client.get(_cache_key(query))
        if raw is None:
            return None
        chunks = _chunks_from_json(raw)
        logger.debug("rag_cache_hit", query_len=len(query), chunks=len(chunks))
        return chunks
    except Exception as exc:  # noqa: BLE001 — cache is best-effort
        logger.warning("rag_cache_get_failed", error=str(exc))
        return None


async def set_cached_chunks(
    redis_client: redis.Redis,
    query: str,
    chunks: list[RetrievedChunk],
    ttl: int = _CACHE_TTL_SECONDS,
) -> None:
    """Store retrieval results in Redis with a TTL (best-effort, never throws)."""
    try:
        await redis_client.set(_cache_key(query), _chunks_to_json(chunks), ex=ttl)
    except Exception as exc:  # noqa: BLE001
        logger.warning("rag_cache_set_failed", error=str(exc))


# ---------------------------------------------------------------------------
# Startup warm-up
# ---------------------------------------------------------------------------

def warmup_rag() -> None:
    """Pre-load the embedding model and ChromaDB collection into memory.

    Call from the application lifespan (inside the executor) so the first real
    user query pays zero cold-start cost.
    """
    logger.info("rag_warmup_start")
    _get_embedder()
    # Also primes the memoized populated-flag so the first query skips count().
    populated = _collection_has_docs(_get_collection())
    logger.info("rag_warmup_done", populated=populated)
