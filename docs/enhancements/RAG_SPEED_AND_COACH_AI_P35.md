# P35 — RAG Response Speed + "Coach AI" Discoverable Entry Point

> Executable prompt for Claude Code, run **autonomously** (see "Autonomy").
> Two workstreams: backend RAG latency, frontend chat discoverability.
> Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. Pose core frozen.

- **Owner:** Claude Code (autonomous)
- **Branch:** `feat/p35-rag-speed-coach-ai`
- **Depends on:** nothing new
- **Thesis metrics:** chat latency is a **measurable thesis metric** — record
  p50/p95 time-to-first-token (TTFT) and total response time before/after, and
  keep `eval_chatbot.py` accuracy ≥80% unchanged (speed must not cost accuracy).

---

## Why P35 exists

**Speed.** RAG answers feel slow. Code audit of `app/api/v1/chat.py`,
`app/chatbot/rag.py`, `gemini_client.py`, `web_search.py` found concrete,
fixable causes (below) — none require changing retrieval quality.

**Discoverability.** Field feedback from a gym trainer: the AI coach is
effectively hidden. Today it is reachable only via Coach tab → start a live
session → floating bubble → a tray that opens on the **Cues** sub-tab, with
Chat as a secondary toggle. A beginner never finds it, and someone who only
wants to *ask a question* must start a camera session first.

---

## Findings — RAG latency (ranked; fix in this order)

1. **Status event emitted after retrieval (perceived-latency bug, biggest win).**
   `_stream_tokens` awaits `_gather_context()` (chat.py:196) *before*
   `yield _sse_status("thinking")` (chat.py:214). The client shows nothing during
   embed + Chroma + (worst case) a 2 s Tavily call. **Fix:** yield the status
   event as the very first statement of the generator, before any awaits.
2. **New `genai.Client` per request.** `_build_model()` is called inside
   `_produce` on every chat call (gemini_client.py:99). **Fix:** module-level
   `@lru_cache(maxsize=1)` singleton (same pattern as `_get_embedder`), built
   lazily, reused thereafter. Keep the `_build_model` seam patched by tests.
3. **New `httpx.AsyncClient` per web search** (web_search.py:51) — full TLS
   handshake each fallback. **Fix:** one shared pooled `AsyncClient` created in
   the app lifespan (`app.state.http`), passed in / looked up; close on shutdown.
4. **`collection.count()` on every retrieval** (rag.py:98,124) — an extra Chroma
   round-trip per query. **Fix:** check once and memoize (warmup already loads
   the collection); treat "empty" as a cached boolean, refreshed on ingest.
5. **Serial retrieval → web search.** In the not-confident path the request pays
   retrieval, *then* up to 2 s of Tavily, before token one. **Fix:** overlap them
   — speculatively launch the web search concurrently with retrieval
   (`asyncio.create_task`) and cancel it when the KB match comes back confident.
   Guard against the wasted call being charged: only speculate when a cheap
   signal suggests it may be needed (agent's call — document the heuristic).
6. **No answer-level cache.** Retrieval is cached (24 h) but the LLM is re-hit for
   identical common questions. **Fix:** short-TTL (e.g. 1–6 h) Redis cache of the
   *final answer text* keyed by normalized query (+ exercise, no frame, no
   history), replayed as SSE tokens on hit. Only cache non-personalized turns
   (skip when `frame`, `history`, or conversational shortcut is in play).
7. Minor: `set_cached_chunks` is awaited inline before returning — make it
   fire-and-forget (`asyncio.create_task`) so it never sits in the critical path.

Already correct — **do not regress:** the executor offload of embedding/Chroma,
`warmup_rag()` in lifespan, the confidence-gating thresholds, and the fallback
chain. Do not change `RETRIEVAL_DISTANCE_THRESHOLD` /
`RETRIEVAL_IRRELEVANT_DISTANCE` or top_k in this prompt — those affect accuracy,
which is a separate thesis metric.

---

## Decisions (settled — do not stop to ask)

1. **Name = "Coach AI"** with a robot/AI icon (`Bot` from lucide-react; a
   `Sparkles` accent is fine). English-only, dark-only.
2. **Placement = both**: (a) a **third floating trigger** in the live view,
   stacked below the existing Coaching/Chat and reference-video buttons
   (`App.tsx:426` cluster), which opens the tray **directly on the Chat
   sub-tab** (not Cues); and (b) a **"Coach AI" card/button on Home** that opens
   the chat **without** requiring a live camera session.
3. Opening chat from Home must not start the camera or a WS session. If the
   existing `ChatPanel` requires a `videoRef`, pass it optionally / null —
   text-only chat is the Home path. Do not modify the frozen camera/pose hooks.
4. Keep the existing combined Coaching/Chat tray as-is for continuity; P35 adds
   a **direct** path, it does not remove the old one.

---

## Goal / Definition of Done

1. Measured on the deployed Space: **TTFT drops substantially** (target: first
   SSE event < 200 ms in every path, since the status event no longer waits on
   retrieval) and total answer time improves on the cached/common-question path.
   Record before/after p50/p95 in `data/eval/` for the thesis.
2. `eval_chatbot.py` accuracy **unchanged (≥80%)** — speed work must not alter
   answers. Run it as the acceptance gate for the backend stage.
3. A first-time user can reach the AI coach in **one tap** from Home, and one tap
   from the live view, labeled "Coach AI" — no nested toggle.
4. All existing tests pass; new code tested; `ruff`/`mypy --strict`/`tsc`/eslint
   clean; pose core untouched.

---

## Stage A — RAG latency (backend)

- Apply findings 1–4 and 7 (status-first, client singletons, shared httpx,
  memoized count, fire-and-forget cache write).
- **Gate:** pytest green; `ruff`; `mypy --strict`; a new test asserting the first
  SSE event is the status event **before** any retrieval work (patch
  `_gather_context` with a slow stub and assert ordering).
- Commit: `[P35] perf: status-first SSE + client singletons + shared http pool`

## Stage B — Speculative web search + answer cache

- Apply findings 5 and 6. Answer cache must be safe: never cache frame-bearing,
  history-bearing, or user-specific turns; store the citation footer with the
  answer so replays stay grounded; version the cache key so a prompt change
  invalidates it.
- **Gate:** pytest — cache hit replays identical tokens + footer; frame/history
  turns bypass the cache; speculative search is cancelled on a confident KB hit
  (assert no stray pending task). `ruff`/`mypy --strict`.
- Commit: `[P35] perf: speculative web fallback + short-TTL answer cache`

## Stage C — "Coach AI" entry points (frontend)

- Third floating trigger in the live-view cluster (`Bot` icon, `aria-label="Open
  Coach AI"`), opening the tray with the Chat sub-tab pre-selected — lift/extend
  the existing `mobileTab` state so it can be opened directly to `"chat"`.
- A "Coach AI" card/button on **Home** that opens the chat without a camera
  session (full-screen sheet or a dedicated view — agent's call, keep it
  one tap and dismissible).
- Copy: label "Coach AI", short subtitle like "Ask about form, sets, nutrition".
- **Gate:** vitest — Home entry opens chat without mounting camera/WS; live-view
  trigger opens the tray already on Chat; existing tray behavior unchanged.
  Playwright for the live-view button cluster layout (no overlap with the
  ScoreRing chip). `tsc`/eslint clean.
- Commit: `[P35] feat: Coach AI — one-tap chat from Home and the live view`

## Stage D — Measure (thesis)

- Add/extend a latency script (e.g. `scripts/eval_chat_latency.py`) recording
  p50/p95 TTFT + total for a fixed question set across paths (cached, KB-confident,
  web-fallback, conversational). Write results to `data/eval/`.
- Re-run `eval_chatbot.py` to confirm accuracy is unchanged.
- **Gate:** both scripts run; results committed; accuracy ≥80%.
- Commit: `[P35] docs: chat latency before/after + accuracy regression check`

End with a PR to `main`, then STOP for review.

---

## Autonomy — how Claude Code should run this prompt

The user reviews **outcomes**, not steps.

- **Decide and proceed.** Open choices (speculative-search heuristic, answer-cache
  TTL, Home chat presentation, exact copy, file layout) are yours — pick the
  sensible option, keep moving, record them in the PR. Do not stop to ask.
- **Move faster:** stages may be completed in one pass; still run each stage's
  gate and commit per stage (audit trail), without pausing between them.
- **Self-verify instead of asking.** Green gates are the bar (pytest + ruff +
  mypy --strict; vitest + tsc + eslint; eval scripts in Stage D). Fix forward
  within the guardrails.
- **Only pause for the human at:** (a) the final PR/merge, and (b) any
  prod-touching or destructive action (deploy, `git push hf`, env/Space change,
  re-ingesting or deleting the Chroma collection, data delete). Running eval
  scripts locally is fine; anything that needs `GEMINI_API_KEY`/
  `WEB_SEARCH_API_KEY` against prod quota → STOP and hand the command to the user.
- Guardrails non-negotiable: pose core FROZEN; additive; retrieval **quality**
  knobs (distance thresholds, top_k, KB content) unchanged in this prompt;
  API keys env-only; structlog only; no JWT in localStorage; dark/English-only.
  If an EXISTING test fails for a reason you can't fix without touching
  frozen/core code, STOP and report.

---

## Guardrails specific to P35

- **Speed must not cost accuracy.** Any change that alters retrieved context or
  prompts requires re-running `eval_chatbot.py`; a drop below 80% blocks the PR.
- The answer cache must never serve one user's personalized turn to another —
  key on normalized query + exercise only, and skip caching whenever `frame` or
  `history` is present.
- Do not remove the existing Coaching/Chat tray or alter `CoachingCues`.
- Do not touch the frozen camera/pose hooks — the Home chat path is text-only.
