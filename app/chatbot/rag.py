"""ChromaDB-backed retrieval for the coaching chatbot.

The collection is populated by ``app.chatbot.ingest`` from markdown files in
``data/knowledge_base/``. At query time the user question is embedded with the
same sentence-transformers model and the top-K chunks are returned.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING

import numpy as np
import numpy.typing as npt
import structlog

if TYPE_CHECKING:
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


@dataclass(frozen=True)
class RetrievedChunk:
    """One retrieved KB chunk with its citation metadata and similarity distance."""

    text: str
    source: str
    title: str
    url: str
    distance: float


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
        if collection.count() == 0:
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
        if collection.count() == 0:
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


def is_confident(chunks: list[RetrievedChunk]) -> bool:
    """True if the best retrieved chunk is within the trust distance threshold."""
    return bool(chunks) and min(c.distance for c in chunks) <= RETRIEVAL_DISTANCE_THRESHOLD


def is_usable(chunks: list[RetrievedChunk]) -> bool:
    """True if chunks are at least marginally on-topic (web-fallback last resort).

    Used only when a live web search is unavailable: marginal chunks are better
    than nothing, but clearly off-topic ones would produce misleading citations.
    """
    return bool(chunks) and min(c.distance for c in chunks) <= RETRIEVAL_IRRELEVANT_DISTANCE
