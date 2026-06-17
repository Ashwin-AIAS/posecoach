"""Posing RAG knowledge base (P18).

The embedder and ChromaDB are stubbed in the test env (see conftest.py), so a
true semantic retrieval can't run here. These tests verify the faithful,
machine-checkable contract instead: the posing knowledge doc is tagged
``domain: posing``, chunks into retrievable sections that contain the mandatory
poses, and flows through ``ingest()`` so the RAG index includes posing content.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from app.chatbot.ingest import chunk_markdown, ingest, parse_frontmatter

POSING_DOC = Path("data/knowledge_base/posing.md")

# A few mandatory-pose queries a user might ask the coach about.
MANDATORY_POSES = ["front double biceps", "rear lat spread", "side chest", "most muscular"]


def test_posing_doc_exists_and_is_tagged_posing() -> None:
    assert POSING_DOC.is_file(), "posing knowledge base file is missing"
    meta, body = parse_frontmatter(POSING_DOC.read_text(encoding="utf-8"))
    assert meta.get("domain") == "posing"
    assert body.startswith("# ")  # frontmatter stripped, markdown body remains


def test_posing_doc_chunks_cover_mandatory_poses() -> None:
    _, body = parse_frontmatter(POSING_DOC.read_text(encoding="utf-8"))
    chunks = chunk_markdown(body)
    assert len(chunks) >= 5  # one section per pose family + faults + holding
    haystack = "\n".join(chunks).lower()
    for pose in MANDATORY_POSES:
        assert pose in haystack, f"no chunk mentions mandatory pose '{pose}'"


def test_retrieving_a_mandatory_pose_query_hits_a_posing_chunk() -> None:
    """Proxy for 'retrieval returns a posing chunk' — a mandatory-pose query
    keyword-matches a chunk that, once ingested, carries domain='posing'."""
    _, body = parse_frontmatter(POSING_DOC.read_text(encoding="utf-8"))
    chunks = chunk_markdown(body)
    query = "how do I hit a front double biceps pose"
    matching = [c for c in chunks if "front double biceps" in c.lower()]
    assert matching, "no posing chunk answers a front-double-biceps query"
    assert any(word in matching[0].lower() for word in query.split())


def test_ingest_includes_posing_chunks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ingest() on an isolated copy of the posing doc adds posing-tagged chunks.

    The real sentence-transformer isn't available in the test env, so embedding
    is stubbed to a fixed-width vector per document — this test exercises the
    chunk → metadata → upsert wiring and the domain tagging, not the embedder.
    """
    from app.chatbot import rag

    monkeypatch.setattr(
        "app.chatbot.ingest.embed_texts", lambda docs: [[0.0] * 384 for _ in docs]
    )

    shutil.copy(POSING_DOC, tmp_path / "posing.md")
    added = ingest(tmp_path)
    assert added >= 5

    # The stubbed collection records the upsert; verify posing chunks + domain tag.
    collection = rag._get_collection()
    upsert = collection.upsert
    assert upsert.called
    kwargs = upsert.call_args.kwargs
    assert all(m["domain"] == "posing" for m in kwargs["metadatas"])
    assert any("front double biceps" in doc.lower() for doc in kwargs["documents"])
