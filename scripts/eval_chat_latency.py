"""Thesis evaluation — chat response latency (TTFT + total).

Measures **time-to-first-token** (strictly: time to the first SSE event the
client receives) and total answer time for the coaching chatbot, per grounding
path. TTFT is what a user actually perceives as "the coach is slow": until the
first event lands the chat surface shows nothing at all.

Two modes:

* ``--mode local`` (default) — drives the SSE endpoint in-process over ASGI
  with the LLM, retrieval and web search replaced by delay stubs. This isolates
  exactly what P35 changed (server-side orchestration and ordering) and needs
  no API key, no quota, and no network. Run it on two commits to get an
  honest before/after.
* ``--mode live --base-url URL`` — real HTTP against a deployed instance. This
  is the end-to-end number for the thesis, and it consumes real Gemini /
  Tavily quota, so it is never run automatically.

Paths measured: ``conversational`` (no retrieval), ``kb_confident`` (retrieval
only), ``web_fallback`` (retrieval + live web search), and ``cached`` (answer
cache replay — P35 only; reported as unavailable on older builds).

Output: ``data/eval/chat_latency.json`` (``--out`` to override, ``--label`` to
tag the run, e.g. ``before`` / ``after``).
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path
from typing import Any

# The limiter is module-level and would trip at 10 requests/min mid-benchmark.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("JWT_SECRET", "eval_chat_latency_placeholder_secret_32")
# Local mode stubs web_search.search entirely; this only makes the code behave
# as it does in production, where a provider key IS configured (the speculative
# fallback is a no-op without one). No real request is ever made.
os.environ.setdefault("WEB_SEARCH_API_KEY", "eval-stub-not-a-real-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import structlog  # noqa: E402

logger = structlog.get_logger(__name__)

OUTPUT_PATH = Path("data/eval/chat_latency.json")

# Defaults model the deployed 2-vCPU Space: embedding + ChromaDB on CPU, a
# Tavily "basic" search, and a typical Gemini Flash first-token wait.
DEFAULT_RETRIEVAL_MS = 700
DEFAULT_WEB_MS = 1500
DEFAULT_LLM_TTFT_MS = 600
DEFAULT_TOKEN_GAP_MS = 25
DEFAULT_TOKENS = 20
DEFAULT_SAMPLES = 12

# DoD: the first SSE event must land well inside this on every path, because it
# no longer waits on retrieval.
TTFT_GATE_MS = 200.0

QUERIES: dict[str, str] = {
    "conversational": "hey",
    "kb_confident": "How deep should I squat?",
    "web_fallback": "What is the latest deadlift world record?",
    "cached": "How much protein should I eat per day?",
}


# --------------------------------------------------------------------------- #
# Local in-process harness                                                     #
# --------------------------------------------------------------------------- #
class _FakeRedis:
    """In-memory stand-in so the answer-cache path can be exercised offline."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int = 0) -> bool:
        self.store[key] = value
        return True


def _install_stubs(
    chat: Any,
    *,
    retrieval_ms: int,
    web_ms: int,
    llm_ttft_ms: int,
    token_gap_ms: int,
    tokens: int,
) -> None:
    """Replace the LLM, retrieval and web search with deterministic delays."""
    from app.chatbot.rag import RetrievedChunk
    from app.chatbot.web_search import WebResult

    confident = RetrievedChunk(
        text="Squat to at least parallel with a braced, neutral spine.",
        source="squat.md",
        title="Squat Technique",
        url="https://example.org/squat",
        distance=0.25,
    )
    miss = RetrievedChunk(
        text="Unrelated chunk.",
        source="general_coaching.md",
        title="General Coaching",
        url="",
        distance=0.95,
    )

    def _retrieve_scored(query: str, top_k: int = 3) -> list[RetrievedChunk]:
        # Sync on purpose: the app offloads this to its executor, so the sleep
        # models real CPU-bound embedding + vector search.
        time.sleep(retrieval_ms / 1000)
        return [confident] if "squat" in query.lower() else [miss]

    async def _search(query: str, k: int = 4, **kwargs: object) -> list[WebResult]:
        await asyncio.sleep(web_ms / 1000)
        return [WebResult(title="Example Source", url="https://example.org/a", snippet="Info.")]

    async def _stream(prompt: str, *args: object, **kwargs: object) -> Any:
        await asyncio.sleep(llm_ttft_ms / 1000)
        for i in range(tokens):
            if i:
                await asyncio.sleep(token_gap_ms / 1000)
            yield "token "

    chat.rag.retrieve_scored = _retrieve_scored
    chat.web_search.search = _search
    chat.gemini_client.stream_chat = _stream
    chat.qwen_client.stream_chat = _stream


def _build_local_app(chat: Any) -> Any:
    """A minimal FastAPI app carrying only the chat router (no model, no DB)."""
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(chat.router)
    app.state.executor = ThreadPoolExecutor(max_workers=2)
    app.state.redis = None  # attached per-path by the runner
    app.state.http = None
    return app


async def _one_local_request(app: Any, body: dict[str, Any]) -> tuple[float, float]:
    """Drive the ASGI app directly, timing the first body chunk and the last."""
    payload = json.dumps(body).encode()
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/chat/stream",
        "raw_path": b"/api/v1/chat/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode()),
            (b"host", b"localhost"),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("localhost", 8000),
    }
    sent = False
    first: float | None = None
    never = asyncio.Event()

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if sent:
            # StreamingResponse races the body against a disconnect listener;
            # returning http.disconnect here would cancel the stream after the
            # first chunk. Block instead — the listener is cancelled when the
            # response finishes.
            await never.wait()
        sent = True
        return {"type": "http.request", "body": payload, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        nonlocal first
        if message["type"] == "http.response.body" and message.get("body") and first is None:
            first = time.perf_counter() - start

    start = time.perf_counter()
    await app(scope, receive, send)
    total = time.perf_counter() - start
    if first is None:
        raise RuntimeError("no SSE body chunk was sent")
    return first * 1000, total * 1000


async def _run_local(args: argparse.Namespace) -> dict[str, Any]:
    from app.api.v1 import chat

    _install_stubs(
        chat,
        retrieval_ms=args.retrieval_ms,
        web_ms=args.web_ms,
        llm_ttft_ms=args.llm_ttft_ms,
        token_gap_ms=args.token_gap_ms,
        tokens=args.tokens,
    )
    app = _build_local_app(chat)
    has_answer_cache = hasattr(chat, "answer_cache")

    results: dict[str, Any] = {}
    for path, query in QUERIES.items():
        if path == "cached" and not has_answer_cache:
            results[path] = {"available": False, "reason": "no answer cache on this build"}
            logger.info("chat_latency_path_skipped", path=path)
            continue

        body: dict[str, Any] = {"query": query}
        if path == "kb_confident":
            body["exercise"] = "squat"
        # Every path except "cached" is measured cold: with Redis attached, the
        # first sample would populate the retrieval/answer caches and the rest
        # would be replays, which is a different measurement.
        app.state.redis = _FakeRedis() if path == "cached" else None
        if path == "cached":
            # Prime the cache with one full (uncached) request first.
            await _one_local_request(app, body)
            await asyncio.sleep(0.05)

        ttfts: list[float] = []
        totals: list[float] = []
        for _ in range(args.samples):
            ttft, total = await _one_local_request(app, body)
            ttfts.append(ttft)
            totals.append(total)

        results[path] = {
            "available": True,
            "samples": args.samples,
            "ttft_ms": _summarize(ttfts),
            "total_ms": _summarize(totals),
        }
        logger.info(
            "chat_latency_path_done",
            path=path,
            ttft_p50=results[path]["ttft_ms"]["p50"],
            total_p50=results[path]["total_ms"]["p50"],
        )
    return results


# --------------------------------------------------------------------------- #
# Live mode                                                                    #
# --------------------------------------------------------------------------- #
async def _run_live(args: argparse.Namespace) -> dict[str, Any]:
    import httpx

    url = args.base_url.rstrip("/") + "/api/v1/chat/stream"
    results: dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=60.0) as client:
        for path, query in QUERIES.items():
            body: dict[str, Any] = {"query": query}
            if path == "kb_confident":
                body["exercise"] = "squat"
            ttfts: list[float] = []
            totals: list[float] = []
            for i in range(args.samples):
                start = time.perf_counter()
                first: float | None = None
                async with client.stream("POST", url, json=body) as resp:
                    resp.raise_for_status()
                    async for _chunk in resp.aiter_bytes():
                        if first is None:
                            first = time.perf_counter() - start
                total = time.perf_counter() - start
                if first is None:
                    raise RuntimeError("empty SSE response")
                ttfts.append(first * 1000)
                totals.append(total * 1000)
                # Endpoint is rate-limited to 10/min per IP.
                if i + 1 < args.samples:
                    await asyncio.sleep(args.live_gap_s)
            results[path] = {
                "available": True,
                "samples": args.samples,
                "ttft_ms": _summarize(ttfts),
                "total_ms": _summarize(totals),
            }
            logger.info("chat_latency_path_done", path=path, ttft_p50=results[path]["ttft_ms"]["p50"])
    return results


# --------------------------------------------------------------------------- #
# Reporting                                                                    #
# --------------------------------------------------------------------------- #
def _summarize(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    return {
        "mean": round(statistics.fmean(ordered), 2),
        "p50": round(statistics.median(ordered), 2),
        "p95": round(ordered[max(0, min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1)))))], 2),
        "min": round(ordered[0], 2),
        "max": round(ordered[-1], 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat TTFT / total-latency benchmark")
    parser.add_argument("--mode", choices=("local", "live"), default="local")
    parser.add_argument("--base-url", default="", help="live mode target, e.g. https://host")
    parser.add_argument("--label", default="after", help="tag for this run (before / after)")
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLES)
    parser.add_argument("--retrieval-ms", type=int, default=DEFAULT_RETRIEVAL_MS)
    parser.add_argument("--web-ms", type=int, default=DEFAULT_WEB_MS)
    parser.add_argument("--llm-ttft-ms", type=int, default=DEFAULT_LLM_TTFT_MS)
    parser.add_argument("--token-gap-ms", type=int, default=DEFAULT_TOKEN_GAP_MS)
    parser.add_argument("--tokens", type=int, default=DEFAULT_TOKENS)
    parser.add_argument("--live-gap-s", type=float, default=7.0)
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    if args.mode == "live" and not args.base_url:
        parser.error("--mode live requires --base-url")

    started = dt.datetime.now(dt.UTC).isoformat()
    paths = asyncio.run(_run_live(args) if args.mode == "live" else _run_local(args))

    measured = [p for p in paths.values() if p.get("available")]
    worst_ttft_p95 = max((p["ttft_ms"]["p95"] for p in measured), default=float("inf"))
    payload: dict[str, Any] = {
        "label": args.label,
        "mode": args.mode,
        "timestamp": started,
        "host": {"platform": platform.platform(), "python": platform.python_version()},
        "config": {
            "samples": args.samples,
            "retrieval_ms": args.retrieval_ms,
            "web_ms": args.web_ms,
            "llm_ttft_ms": args.llm_ttft_ms,
            "token_gap_ms": args.token_gap_ms,
            "tokens": args.tokens,
        }
        if args.mode == "local"
        else {"samples": args.samples, "base_url": args.base_url},
        "paths": paths,
        "worst_ttft_p95_ms": worst_ttft_p95,
        "ttft_gate_ms": TTFT_GATE_MS,
        "ttft_gate_passed": worst_ttft_p95 < TTFT_GATE_MS,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(f"\nChat latency ({args.label}, {args.mode}) -> {args.out}")
    for name, path in paths.items():
        if not path.get("available"):
            print(f"  {name:<14} n/a ({path.get('reason')})")
            continue
        print(
            f"  {name:<14} TTFT p50 {path['ttft_ms']['p50']:>8.1f} ms | "
            f"p95 {path['ttft_ms']['p95']:>8.1f} ms | "
            f"total p50 {path['total_ms']['p50']:>8.1f} ms"
        )
    verdict = "PASS" if payload["ttft_gate_passed"] else "FAIL"
    print(f"  worst TTFT p95 {worst_ttft_p95:.1f} ms (gate < {TTFT_GATE_MS:.0f} ms) — {verdict}")
    sys.exit(0 if payload["ttft_gate_passed"] else 1)


if __name__ == "__main__":
    main()
