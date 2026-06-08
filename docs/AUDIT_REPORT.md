# PoseCoach Audit — 2026-06-07

> Read-only staff-level due-diligence review. No code was changed. Every finding
> below was verified against the actual file/line, not the CLAUDE.md claims.
> Verification run: `pytest` → **350 passed**, `app/analysis` coverage **97.85%**;
> `ruff check app/` → **1 error**; invariant greps (`end2end=False`, `.boxes`,
> NMS, `localStorage`, hardcoded secrets) → **clean**.

## Executive summary

This is unusually disciplined work for a thesis project — the documented YOLO26
invariants are genuinely upheld in code (no `end2end=False`, keypoints via
`.xyn`, model loaded once in lifespan, inference in an executor), JWTs really are
httpOnly-cookie-only, IDOR is correctly guarded, and the analysis layer has
real, high-coverage tests (97.85%). The core CV/scoring code is clean,
deterministic, and well-reasoned. The gap is **product-grade operability, not
correctness**: the live deployment can serve only a handful of concurrent users
(2-thread executor + single uvicorn worker + one shared model), the WebSocket
and chat endpoints accept unbounded frame payloads with no size cap, anonymous
WS sockets are completely unmetered, and the image that actually runs in
production (root `Dockerfile`) never applies database migrations. **The single
most important thing to fix is the concurrency ceiling** — everything else is
secondary to the fact that the system as deployed cannot scale past ~2–4 live
sessions.

**Critical: 0  |  High: 4** — worry moderately. Nothing is on fire or exploitable
for data theft, but four issues block a real multi-user launch.

## Top 10 findings (ranked)

| # | Severity | Area | File:line | Issue | Fix |
|---|----------|------|-----------|-------|-----|
| 1 | High | Perf/Scale | `app/main.py:95`, `Dockerfile:49` | `ThreadPoolExecutor(max_workers=2)` + `--workers 1` + one shared `app.state.model` caps the whole service at ~2 concurrent inferences. At 15 fps per WS client, 3–5 simultaneous users saturate it and p95 latency explodes. | Raise worker/executor counts to match vCPUs; consider a dedicated inference process pool or Modal GPU offload; load-test concurrent WS, not single-frame. |
| 2 | High | Security/Reliability | `app/api/v1/ws_inference.py:206`, `app/api/v1/chat.py:41` | No size cap on the base64 `frame` in either the WS handler or `ChatRequest` (`query` is capped at 2000, `frame` is unbounded). One oversized frame can spike memory and stall the single worker for everyone. | Reject frames over a fixed byte budget (e.g. ~256 KB) before `b64decode`; add `max_length` to the chat `frame` field. |
| 3 | High | Security | `app/api/v1/ws_inference.py:148` | The per-user WS connection guard is `None` for anonymous users (`conn_guard_key = ... if session_user_id else None`), and there is no global cap on concurrent sockets. Anyone can open unlimited anonymous WS connections → unmetered resource abuse / DoS. | Add a global active-connection ceiling and an IP-based guard for anonymous sockets. |
| 4 | High | Reliability/Deploy | `Dockerfile:49` vs `docker-compose*.yml` | The root Dockerfile (what HF Spaces builds — see `docs/hf_migration_handoff.md`) runs `uvicorn …` with **no `alembic upgrade head`**. Only the dev/prod compose files migrate. The live backend has no automatic migration step → schema drift the moment a 0003 migration exists. | Add `alembic upgrade head &&` to the Dockerfile CMD (or an entrypoint), matching the compose files. |
| 5 | Med | ML correctness / Docs | `app/analysis/keypoint_utils.py:38` | Keypoint confidence gate is **0.25** (env-overridable, "interim" P11 value), but `CLAUDE.md` and `.claude/rules/yolo26.md` both mandate **0.5**. Code violates its own documented invariant, and the threshold is explicitly un-calibrated against real data. | Either update the docs to 0.25 with the P11 rationale, or finish the in-gym calibration and set the measured value. Don't leave the rule and the code disagreeing. |
| 6 | Med | Thesis integrity / Perf | `app/main.py:88-93`, `app/inference/runner.py:58-59` | Prod prefers the `.pt` and runs it at **imgsz=320**, but the headline latency (`data/eval/latency_results.json`: p95 57.2 ms) is **ONNX @ 640, colab_cached** — a config that is never deployed. The deployed latency is unmeasured. | Benchmark the actually-deployed `.pt@320` path and report that number (or deploy the benchmarked config). |
| 7 | Med | Security | `app/middleware/security_headers.py:24` | CSP uses `script-src 'self' 'unsafe-inline'`, which defeats much of CSP's XSS value for the React SPA. | Drop `unsafe-inline` for scripts (use hashes/nonces if Vite injects inline bootstrap); keep it only for `style-src` if needed. |
| 8 | Med | Thesis rigor | `scripts/eval_chatbot.py:111-113,167` | `answer_accuracy` is graded by **substring keyword match** on the generated answer — a lenient proxy that can over-report the headline ≥80% metric. | Note the limitation in the thesis, or upgrade to the deferred Qwen VLM-judge / semantic grading. |
| 9 | Low | Docs/code drift | `app/chatbot/qwen_client.py:21`, `app/chatbot/router.py:6` | Code uses `qwen/qwen2.5-vl-72b-instruct` and the router docstring still says "Gemini 2.0 Flash" (retired 2026-06-01), while docs say "Qwen 3.6 / Gemini 3.5". Misleading for a new engineer. | Align names: docstrings/CLAUDE.md ↔ actual model IDs. |
| 10 | Low | Quality gate | `app/api/v1/chat.py:24` | `ruff check app/` currently fails: `FALLBACK_MESSAGE` imported but unused. The documented gate ("ruff must pass before any commit") is red on `main`. | `ruff check app/ --fix` and re-commit; wire ruff into CI to keep it green. |

## Findings by dimension

### 1. Architecture & boundaries
Solid. Model loaded once in lifespan (`main.py:94`), inference in executor
(`runner.py:95`), one `KeypointSmoother`/`ScoreSmoother`/`RepCounter`/
`ExerciseVerifier` per connection with `.reset()`/recreate on disconnect or
exercise change (`ws_inference.py:117-121,261,271,454`). Business logic lives in
`app/analysis`, not in routes. The single-slot latest-frame buffer
(`ws_inference.py:155-176`) is a genuinely good backpressure design. A second
engineer could onboard. Minor: `ws_inference.ws_inference` is one ~390-line
function doing receive/score/verify/persist/instrument — splitting the per-frame
body out would help (Med-Low maintainability).

### 2. ML / CV correctness
- YOLO26 traps: **all clear** — no `end2end=False`, no NMS, no `.boxes`,
  `model.fuse()` present in export paths, `torch.cuda.empty_cache()` every 100
  frames (`runner.py:64`), keypoints via `.xyn` (`runner.py:111`).
- Scorer is deterministic (no RNG; pure numpy piecewise), `ANGLE_RANGES` loaded
  from JSON not inlined (`form_scorer.py:14-16`), cues verified ≤ 8 words. ✔
- Smoothing α=0.6 per-connection ✔; rep counter hysteresis + amplitude/cadence
  guards are sound and the max-across-machines design correctly handles
  unilateral lifts (`rep_counter.py`).
- **Finding (Med):** only the *first* detected person is scored
  (`runner.py:111`, `keypoints.xyn[0]`). In a real gym with multiple people in
  frame this can track the wrong person — no largest-bbox/centre selection.
- See Top-10 #5 (conf gate) and #6 (deployed vs benchmarked model).
- Eval rigor: `eval_yolo`/`eval_latency` honestly tag `colab_cached` provenance
  and never hardcode a pass; `eval_form_consistency` is real but measures *scorer*
  determinism on synthetic forward-kinematic skeletons, not the full
  YOLO→angle pipeline (fine, but scope worth stating in the thesis). See #8 for
  the chatbot metric.

### 3. Security & secrets
Strong. No hardcoded secrets anywhere (grepped tree; `.env` is gitignored and
untracked). JWT HS256 in httpOnly+secure(prod)+samesite=lax cookies, never in
body or localStorage (frontend even has a test asserting no localStorage,
`useWebSocket.test.ts:163`). Refresh-token rotation with DB hash + revoke
(`auth.py:113-150`). IDOR correctly prevented — every history query filters by
`user_id` (`history.py:30,55,78`). `DELETE /auth/account` cascades (GDPR).
`/metrics` is bearer-token gated with `secrets.compare_digest`. Rate limits on
auth + chat (10/min). Frames never written to disk; logging never includes
frames/keypoints/tokens. Gaps: Top-10 #2 (no frame-size validation), #3
(anonymous WS abuse), #7 (CSP `unsafe-inline`).

### 4. Reliability & error handling
Good. `/health/deep` correctly raises 503 when any dep is down
(`main.py:209-210`); global `Exception` handler hides stack traces
(`main.py:35-42`); LLM failure → smart fallback is actually wired and the Gemini
streamer re-raises so the fallback fires (`gemini_client.py:104`,
`chat.py:117-123`); WS disconnect/cleanup releases the guard, resets smoothers,
and persists the session in a `finally` (`ws_inference.py:448-479`). `bare
except` count: **0** (all are scoped or `noqa: BLE001` best-effort fallbacks with
logging). Minor: `run_inference` swallowing all exceptions as "no person"
(`runner.py:96-98`) masks genuine inference errors from the user.

### 5. Performance & scalability
The weak dimension — see Top-10 #1. Beyond the executor ceiling: ChromaDB
embedding + query run on the executor too (`rag.py`), competing with inference
threads under chat+pose load. DB access is clean (indexed `user_id`, `limit`
capped at 200, no N+1 seen). Frontend is well done: 15 fps cap via rAF,
single-in-flight backpressure, RTT-driven adaptive quality, visibilitychange
camera release (`usePoseStream.ts`, `useCamera.ts`).

### 6. Tests & verification
Claim verified: **350 pass, 97.85% on `app/analysis`** (exceeds the 80% gate).
SQLite in-memory per the rule; Gemini/Qwen/Redis/Chroma/YOLO all mocked
(`conftest.py`). WS handler has real integration tests incl. all exercises,
missing-frame, invalid-exercise. Honest gap: tests cover `app/analysis` deeply
but `app/api`, `app/chatbot`, `app/auth` have no enforced coverage floor, and
there is no concurrency/load test despite that being the #1 risk.

### 7. Code quality & maintainability
Generally high — full type hints, structlog everywhere (no `print()`;
`logging.getLogger()` only legitimately in `logging_config.py`), constants
hoisted, Google-style docstrings. Issues: ruff red on `main` (#10);
`setup_logging()` is not idempotent — it appends a root handler every call, so
repeated lifespan starts duplicate log lines (visible as ~16× repeats in the
test run), `logging_config.py:45-47` (Low); `KeypointSmoother.update` returns the
raw input array on first call rather than a copy (`smoother.py:22-23`) — caller
mutation could leak into `_prev` (Low). Frontend: no `any` found, components
reasonably sized.

### 8. Product / startup readiness
Biggest risk to paying users: **it doesn't scale past a few concurrent sessions**
(#1), and a single large frame can stall the one worker (#2/#3). Missing for
product-grade: automatic migrations in the deployed image (#4), a benchmark of
the config actually shipped (#6), per-user/anonymous abuse controls, and a CI
gate that keeps ruff/mypy/tests green. What *is* product-grade: observability
(Prometheus + Grafana + structured JSON logs), secrets hygiene, graceful LLM/RAG
degradation, GDPR delete, and a documented deploy topology.

## What's done well
- YOLO26 invariants genuinely honored in code — not just in the docs.
- Real, high-coverage, well-isolated tests on the scoring core (97.85%).
- Privacy posture is excellent: no frames to disk, no tokens/PII in logs, JWT
  cookie-only with a frontend test enforcing it, GDPR account delete.
- Thoughtful real-time engineering: latest-frame backpressure, adaptive capture
  quality, per-connection smoother/rep-counter lifecycle.
- Honest eval scripts — cached results are provenance-tagged, gates use hard exit
  codes, no fabricated "pass".
- Mature degradation everywhere (LLM→fallback, RAG→web→general, Redis guard fails
  open).

## Recommended next 5 actions
1. **(L) Fix the concurrency ceiling** — size executor/uvicorn workers to the
   host, isolate inference from RAG, load-test N concurrent WS clients. *Improves:
   real-world p95 latency & max users (the headline product metric).*
2. **(S) Cap frame payload size** on WS + chat before decode. *Improves: DoS
   resistance / single-worker stability.*
3. **(S) Add `alembic upgrade head` to the Dockerfile CMD/entrypoint.** *Improves:
   deploy reliability / prevents future prod schema drift.*
4. **(S) Meter anonymous WS connections** (global cap + IP guard). *Improves:
   abuse resistance.*
5. **(M) Reconcile measured vs deployed** — benchmark `.pt@320` and align the
   conf-gate (0.25 vs 0.5) and model-name docs with the code. *Improves: thesis
   integrity & onboarding clarity.*

---
**Critical + High count: 4** (0 Critical, 4 High). Moderate concern: no security
hole or data-loss bug, but four operability issues must be closed before a
multi-user, paying launch.
