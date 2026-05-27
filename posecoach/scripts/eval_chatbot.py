"""Thesis evaluation — RAG chatbot accuracy gate.

Grades the coaching chatbot against 50 curated Q&A pairs (``chatbot_qa.json``)
on two axes:

* **retrieval_recall** — fraction of questions whose top-k retrieved context
  contains an expected ``context_keyword``. Always runs: uses the real
  ChromaDB retriever (``app.chatbot.rag.retrieve``) when available, else a
  lightweight keyword retriever over ``data/knowledge_base/*.md``.
* **answer_accuracy** — fraction of generated answers containing an expected
  ``answer_keyword``. Runs only when Gemini is usable (``GEMINI_API_KEY`` set
  and ``google-generativeai`` installed); calls are throttled to respect the
  free-tier rate limit.

The thesis gate is **answer_accuracy >= 0.80**. If no LLM is available the gate
is left indeterminate (exit 2) and retrieval_recall is still reported, so the
script must be run in an environment with the API key to produce the headline
number.

Output: ``data/eval/chatbot_results.json``.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import math
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import structlog

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.chatbot import gemini_client, rag  # noqa: E402
from app.chatbot.ingest import chunk_markdown  # noqa: E402
from app.chatbot.prompts import build_user_prompt  # noqa: E402

# TF-IDF document vector: (term -> weight) plus its L2 norm.
TfidfVec = tuple[dict[str, float], float]

logger = structlog.get_logger(__name__)

QA_PATH = Path(__file__).resolve().parent / "chatbot_qa.json"
KB_DIR = Path("data/knowledge_base")
OUTPUT_PATH = Path("data/eval/chatbot_results.json")
TOP_K = 3
ACCURACY_GATE = 0.80
LLM_THROTTLE_S = 4.0  # Gemini free tier ~15 req/min
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _load_kb_chunks() -> list[str]:
    """Chunk the knowledge base exactly as production ingest does (## headings)."""
    chunks: list[str] = []
    for md in sorted(KB_DIR.glob("*.md")):
        if md.name.lower() == "readme.md":
            continue
        chunks.extend(chunk_markdown(md.read_text(encoding="utf-8")))
    return chunks


def _build_tfidf(chunks: list[str]) -> tuple[dict[str, float], list[TfidfVec]]:
    """Compute IDF weights and per-chunk TF-IDF vectors (cosine-ready)."""
    n = len(chunks)
    doc_freq: Counter[str] = Counter()
    tokenized = [_tokenize(c) for c in chunks]
    for toks in tokenized:
        doc_freq.update(set(toks))
    idf = {t: math.log((n + 1) / (df + 1)) + 1.0 for t, df in doc_freq.items()}

    doc_vecs: list[TfidfVec] = []
    for toks in tokenized:
        tf = Counter(toks)
        vec = {t: tf[t] * idf[t] for t in tf}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        doc_vecs.append((vec, norm))
    return idf, doc_vecs


def _tfidf_retrieve(
    query: str,
    chunks: list[str],
    idf: dict[str, float],
    doc_vecs: list[TfidfVec],
    top_k: int,
) -> list[str]:
    """TF-IDF cosine retrieval fallback when ChromaDB is unavailable."""
    q_tf = Counter(_tokenize(query))
    q_vec = {t: q_tf[t] * idf.get(t, 0.0) for t in q_tf}
    q_norm = math.sqrt(sum(v * v for v in q_vec.values())) or 1.0
    scored: list[tuple[float, int]] = []
    for i, (vec, norm) in enumerate(doc_vecs):
        dot = sum(q_vec.get(t, 0.0) * w for t, w in vec.items())
        scored.append((dot / (q_norm * norm), i))
    scored.sort(reverse=True)
    return [chunks[i] for score, i in scored[:top_k] if score > 0.0]


def _keyword_hit(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(kw.lower() in lowered for kw in keywords)


async def _generate(prompt: str, executor: ThreadPoolExecutor) -> str:
    tokens: list[str] = []
    async for tok in gemini_client.stream_chat(prompt, executor=executor):
        tokens.append(tok)
    return "".join(tokens)


def _llm_available() -> bool:
    if not os.environ.get("GEMINI_API_KEY"):
        return False
    try:
        import google.generativeai  # noqa: F401
    except ImportError:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG chatbot accuracy eval")
    parser.add_argument("--max", type=int, default=0, help="Limit number of Q&A pairs (0 = all).")
    args = parser.parse_args()

    qa = json.loads(QA_PATH.read_text())["pairs"]
    if args.max > 0:
        qa = qa[: args.max]

    kb_chunks = _load_kb_chunks()
    idf, doc_vecs = _build_tfidf(kb_chunks)
    use_llm = _llm_available()
    executor = ThreadPoolExecutor(max_workers=1) if use_llm else None

    retrieval_hits = 0
    answer_hits = 0
    answers_evaluated = 0
    details: list[dict[str, Any]] = []

    for pair in qa:
        question = pair["question"]
        chunks = rag.retrieve(question, top_k=TOP_K)
        retriever = "chromadb"
        if not chunks:
            chunks = _tfidf_retrieve(question, kb_chunks, idf, doc_vecs, TOP_K)
            retriever = "offline_tfidf"
        context_text = " ".join(chunks)
        retrieved_ok = _keyword_hit(context_text, pair["context_keywords"])
        retrieval_hits += int(retrieved_ok)

        answer_ok: bool | None = None
        if use_llm and executor is not None:
            prompt = build_user_prompt(question, chunks, exercise=pair.get("exercise"))
            answer = asyncio.run(_generate(prompt, executor))
            answer_ok = _keyword_hit(answer, pair["answer_keywords"])
            answer_hits += int(answer_ok)
            answers_evaluated += 1
            time.sleep(LLM_THROTTLE_S)

        details.append(
            {
                "id": pair["id"],
                "exercise": pair["exercise"],
                "retriever": retriever,
                "retrieved_ok": retrieved_ok,
                "answer_ok": answer_ok,
            }
        )
        logger.info(
            "chatbot_qa_graded",
            id=pair["id"],
            retrieved_ok=retrieved_ok,
            answer_ok=answer_ok,
            retriever=retriever,
        )

    n = len(qa)
    retrieval_recall = round(retrieval_hits / n, 4) if n else 0.0
    answer_accuracy = (
        round(answer_hits / answers_evaluated, 4) if answers_evaluated else None
    )

    if answer_accuracy is None:
        gate_passed: bool | None = None
        gate_reason = "no_llm_available — set GEMINI_API_KEY and install google-generativeai"
        exit_code = 2
    else:
        gate_passed = answer_accuracy >= ACCURACY_GATE
        gate_reason = "evaluated"
        exit_code = 0 if gate_passed else 1

    payload = {
        "metric": "chatbot_accuracy",
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "n_pairs": n,
        "top_k": TOP_K,
        "gate_accuracy": ACCURACY_GATE,
        "retrieval_recall": retrieval_recall,
        "answer_accuracy": answer_accuracy,
        "answers_evaluated": answers_evaluated,
        "llm_used": use_llm,
        "llm_model": gemini_client.MODEL_NAME if use_llm else None,
        "thesis_gate_passed": gate_passed,
        "gate_reason": gate_reason,
        "details": details,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2))
    logger.info(
        "chatbot_eval_complete",
        retrieval_recall=retrieval_recall,
        answer_accuracy=answer_accuracy,
        gate_passed=gate_passed,
        output=str(OUTPUT_PATH),
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
