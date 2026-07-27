# P35 — Chat latency: before / after

Measured 2026-07-27 with `scripts/eval_chat_latency.py` (local mode, 12 samples
per path). **Before** = `origin/main` at `941d448` (pre-P35), run from a git
worktree with the same script copied in, so both columns are the *real* code
paths rather than a simulation of the old ordering.

## Method

Local mode drives the SSE endpoint in-process over ASGI and replaces the three
slow external dependencies with fixed delays, so the numbers isolate exactly
what P35 changed — server-side orchestration and event ordering — and are
reproducible without API keys, quota, or a network:

| Stub | Delay | Models |
|------|-------|--------|
| retrieval (`rag.retrieve_scored`) | 700 ms (blocking, runs in the app executor) | embedding + ChromaDB on the deployed 2-vCPU Space |
| web search (`web_search.search`) | 1500 ms | a Tavily "basic" search (client timeout is 2 s) |
| LLM (`gemini_client.stream_chat`) | 600 ms to first token, then 20 tokens × 25 ms | Gemini Flash streaming |

TTFT is the time until the **first SSE event reaches the client** — until that
lands the chat surface shows nothing, which is what "the coach feels slow"
actually means. Every path except `cached` is measured cold (Redis detached),
so no sample is served from a warm cache.

## Results

| Path | TTFT p50 before → after | TTFT p95 before → after | Total p50 before → after |
|------|------------------------|-------------------------|--------------------------|
| conversational | 0.49 → **0.46 ms** | 0.57 → **0.62 ms** | 1193 → 1196 ms |
| kb_confident | 701.1 → **0.27 ms** | 701.3 → **0.34 ms** | 1898 → 1898 ms |
| web_fallback | 2209.4 → **0.26 ms** | 2213.3 → **0.32 ms** | 3400 → **2705 ms** |
| cached | n/a (no answer cache) | n/a | n/a → **0.3 ms** |

Reading the table:

- **TTFT collapses to sub-millisecond on every path.** The status event is now
  the first statement of the generator, so it no longer sits behind embedding +
  ChromaDB (−701 ms on the KB path) or behind embedding + a live web search
  (−2209 ms on the fallback path). Worst-path TTFT p95 is 0.62 ms against the
  200 ms DoD gate.
- **Total time is unchanged where nothing else changed** (conversational, KB) —
  the reordering moves the wait, it does not remove work, and the numbers show
  no regression from the new machinery.
- **The web-fallback path is ~695 ms faster end to end**, which is the
  speculative search overlapping the 700 ms retrieval instead of following it.
- **A repeated common question now answers in ~0.2 ms** instead of paying the
  full ~1.9 s generation, via the short-TTL answer cache.

Raw output: `data/eval/chat_latency_before_2026-07-27.json`,
`data/eval/chat_latency_after_2026-07-27.json`.

## Accuracy regression check

`scripts/eval_chatbot.py`, run on both commits against the same ChromaDB index:

| | before (941d448) | after (P35) |
|---|---|---|
| retrieval_recall | 0.84 | **0.84** |
| answer_accuracy | indeterminate — no LLM in this environment | indeterminate |

Retrieval is byte-for-byte unaffected, as expected: P35 changed no distance
threshold, no `top_k`, no KB content, and no prompt.

`answer_accuracy` (the ≥80% thesis gate) needs a real Gemini key and burns
free-tier quota, so it is **not** run automatically. To produce the headline
number:

```bash
GEMINI_API_KEY=<key> python scripts/eval_chatbot.py
# writes data/eval/chatbot_results.json; the gate is answer_accuracy >= 0.80
```

## Live (deployed) measurement

The local numbers isolate server-side orchestration. For the end-to-end figure
on the Space — which includes network RTT and the real Gemini/Tavily calls, and
therefore consumes quota:

```bash
python scripts/eval_chat_latency.py --mode live \
  --base-url https://<space-host> --label after-live --samples 8 \
  --out data/eval/chat_latency_live.json
```

The endpoint is rate-limited to 10 requests/min per IP; the script paces itself
with `--live-gap-s` (default 7 s).
