"""Ingest markdown knowledge base files into ChromaDB.

Usage:
    python -m app.chatbot.ingest [--source data/knowledge_base] [--reset]

Chunking strategy: split each markdown file on top-level ``## `` headings so
each section (e.g. "Common Form Faults") becomes one chunk. Sections shorter
than ``MIN_CHUNK_CHARS`` are merged with the next sibling to avoid stub chunks.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

import numpy as np
import numpy.typing as npt
import structlog

from app.chatbot.rag import COLLECTION_NAME, _get_collection, embed_texts

logger = structlog.get_logger(__name__)

DEFAULT_SOURCE = Path("data/knowledge_base")
MIN_CHUNK_CHARS = 200
SECTION_SPLIT = re.compile(r"^##\s+", flags=re.MULTILINE)


def chunk_markdown(text: str) -> list[str]:
    """Split markdown into chunks at ``##`` headings, merging tiny sections."""
    sections = [s.strip() for s in SECTION_SPLIT.split(text) if s.strip()]
    if not sections:
        return []

    chunks: list[str] = []
    buffer = ""
    for section in sections:
        candidate = f"{buffer}\n\n## {section}".strip() if buffer else f"## {section}"
        if len(candidate) < MIN_CHUNK_CHARS:
            buffer = candidate
            continue
        chunks.append(candidate)
        buffer = ""
    if buffer:
        if chunks:
            chunks[-1] = f"{chunks[-1]}\n\n{buffer}"
        else:
            chunks.append(buffer)
    return chunks


def chunk_id(source: str, text: str) -> str:
    """Deterministic chunk ID — lets us re-ingest without duplicates."""
    digest = hashlib.sha1(f"{source}:{text}".encode()).hexdigest()[:16]
    return f"{source}-{digest}"


def ingest(source_dir: Path, reset: bool = False) -> int:
    """Ingest every ``*.md`` file under ``source_dir`` into the collection.

    Returns the total number of chunks added.
    """
    if not source_dir.is_dir():
        raise FileNotFoundError(f"Source directory not found: {source_dir}")

    collection = _get_collection()

    if reset:
        # PersistentClient: delete + recreate to clear all docs
        import os

        import chromadb

        chroma_path = os.environ.get("CHROMA_PATH", "data/chroma")
        client = chromadb.PersistentClient(path=chroma_path)
        try:
            client.delete_collection(name=COLLECTION_NAME)
            logger.info("collection_reset", name=COLLECTION_NAME)
        except Exception:  # noqa: BLE001 — collection may not exist
            pass
        from app.chatbot import rag  # re-cache cleared collection

        rag._get_collection.cache_clear()
        collection = rag._get_collection()

    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, str]] = []

    for md_file in sorted(source_dir.glob("*.md")):
        if md_file.name.lower() == "readme.md":
            continue
        text = md_file.read_text(encoding="utf-8")
        chunks = chunk_markdown(text)
        logger.info("chunked_file", file=md_file.name, chunks=len(chunks))
        for chunk in chunks:
            cid = chunk_id(md_file.name, chunk)
            ids.append(cid)
            documents.append(chunk)
            metadatas.append({"source": md_file.name})

    if not documents:
        logger.warning("nothing_to_ingest", source=str(source_dir))
        return 0

    embeddings: npt.NDArray[np.float32] = np.asarray(embed_texts(documents), dtype=np.float32)
    # ChromaDB's signature types metadatas as Mapping[str, scalar] | list[...]; our
    # list[dict[str, str]] is a valid element type but list/dict invariance trips mypy.
    collection.upsert(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)
    logger.info("ingest_complete", total_chunks=len(documents))
    return len(documents)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest knowledge base into ChromaDB")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--reset", action="store_true", help="Drop the existing collection first")
    args = parser.parse_args()
    ingest(args.source, reset=args.reset)


if __name__ == "__main__":
    main()
