"""ChromaDB-backed retrieval for the coaching chatbot.

The collection is populated by ``app.chatbot.ingest`` from markdown files in
``data/knowledge_base/``. At query time the user question is embedded with the
same sentence-transformers model and the top-K chunks are returned.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    from chromadb.api.models.Collection import Collection
    from sentence_transformers import SentenceTransformer

logger = structlog.get_logger(__name__)

COLLECTION_NAME = "posecoach_knowledge"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_TOP_K = 3


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
        result = collection.query(query_embeddings=[query_embedding], n_results=top_k)
        documents = result.get("documents", [[]])
        chunks: list[str] = list(documents[0]) if documents else []
        logger.info("rag_retrieved", query_len=len(query), chunks=len(chunks))
        return chunks
    except Exception as exc:  # noqa: BLE001 — RAG is best-effort; never break chat
        logger.error("rag_retrieve_failed", error=str(exc))
        return []
