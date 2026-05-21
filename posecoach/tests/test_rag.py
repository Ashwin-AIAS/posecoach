"""RAG chunking + retrieval tests (ChromaDB + sentence-transformers are stubbed)."""
from __future__ import annotations

from app.chatbot.ingest import chunk_id, chunk_markdown
from app.chatbot.prompts import build_context_block, build_user_prompt


def test_chunk_markdown_splits_on_h2() -> None:
    section_a = "Body of section A. " * 20  # ~380 chars — comfortably above threshold
    section_b = "Body of section B. " * 20
    md = (
        f"# Title\n\nIntro line.\n\n"
        f"## Section A\n\n{section_a}\n\n"
        f"## Section B\n\n{section_b}"
    )
    chunks = chunk_markdown(md)
    assert len(chunks) == 2
    assert "Section A" in chunks[0]
    assert "Section B" in chunks[1]


def test_chunk_markdown_merges_tiny_section() -> None:
    md = (
        "## Tiny\n\nshort\n\n"
        "## Big section\n\n"
        "This section has enough text to satisfy the minimum chunk size threshold "
        "that the ingester applies, so the previous tiny section gets merged into it."
    )
    chunks = chunk_markdown(md)
    assert len(chunks) == 1
    assert "Tiny" in chunks[0]
    assert "Big section" in chunks[0]


def test_chunk_id_is_deterministic() -> None:
    a = chunk_id("squat.md", "some chunk text")
    b = chunk_id("squat.md", "some chunk text")
    c = chunk_id("squat.md", "different text")
    assert a == b
    assert a != c


def test_build_context_block_empty() -> None:
    assert build_context_block([]) == ""


def test_build_context_block_formats_sources() -> None:
    block = build_context_block(["chunk one", "chunk two"])
    assert "[Source 1]" in block
    assert "[Source 2]" in block
    assert "chunk one" in block


def test_build_user_prompt_includes_query_and_exercise() -> None:
    prompt = build_user_prompt("Why knees cave?", ["context"], exercise="squat")
    assert "Why knees cave?" in prompt
    assert "squat" in prompt
    assert "context" in prompt


def test_build_user_prompt_without_context_or_exercise() -> None:
    prompt = build_user_prompt("Question?", [])
    assert "Question?" in prompt
    assert "Relevant reference" not in prompt
