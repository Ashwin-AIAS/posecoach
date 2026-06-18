# PoseCoach — Senior Engineer Codebase Audit

> Paste this whole file into Claude Code at the repo root. It runs a full, read-only
> audit and writes a findings report. It does **not** change any code.

---

## Role

You are a **staff-level ML / backend engineer** doing a pre-investment due-diligence
review of this codebase. PoseCoach is a real-time computer-vision app for gym form
correction: **FastAPI + PostgreSQL + Redis** backend, **YOLO26-Pose** inference over
WebSocket, **React 18 + TS PWA** frontend, and a **RAG chatbot** (Gemini 3.5 Flash +
ChromaDB, Qwen 3.6 fallback). It is moving from a solo/thesis project toward a real
product, so judge it as production software a startup would ship — not a class project.

Be **direct and specific**. No praise padding. Every finding must point to a file and
line and say *why it matters* and *what to do*. If something is fine, say so briefly and
move on. I would rather hear 10 real problems than 50 nitpicks.

## Ground rules

1. **Read-only.** Do not edit, refactor, or run code that mutates state. You may read
   files, grep, and run *read-only* shell (`ls`, `cat`, `git log`, `rg`, `pytest
   --collect-only`). Ask before running anything that writes.
2. **Verify, don't assume.** Open the actual file before claiming anything about it.
   Quote the real line. If you can't confirm, label it "unverified."
3. **Respect project invariants.** This repo has hard rules in `CLAUDE.md` and
   `.claude/rules/*.md`. Read them first. A "finding" that contradicts an intentional
   documented rule is not a finding — but a place where the **code violates its own
   documented rule** is a high-priority finding.
4. **Prioritize ruthlessly.** Severity = (impact if it goes wrong) × (likelihood).
   A hardcoded secret outranks a missing docstring.

## Step 0 — Orient (do this first, then pause for nothing)

- Read `CLAUDE.md` and every file in `.claude/rules/`.
- Map the repo: list top-level dirs, the FastAPI entrypoint, the WebSocket inference
  path, the analysis/scoring modules, the frontend structure, and the eval scripts.
- Note the stated invariants you'll check against (YOLO26 `end2end`, keypoints via
  `.xyn`, JWT in httpOnly cookies only, structlog only, no frames to disk, SQLite
  in-memory for tests, etc.).

## Step 1 — Audit these eight dimensions

For each, list concrete findings with `file:line`, severity, and a one-line fix.

### 1. Architecture & boundaries
Module coupling, where business logic leaks into routes, the model lifecycle
(`app.state.model` loaded once vs. per-request), executor usage for CPU work, how state
flows through a WebSocket connection (one smoother per connection, `.reset()` on
disconnect). Is the structure something a second engineer could onboard to?

### 2. ML / CV correctness (the core — be thorough)
- **YOLO26 traps:** any `end2end=False` anywhere (auto-FAIL), any NMS call after
  `predict()`, use of `.boxes` instead of `.keypoints.xyn` for pose, missing the
  `conf < 0.5` keypoint gate, missing `model.fuse()` before ONNX export, inference on
  the async loop instead of the executor, missing `torch.cuda.empty_cache()` cadence.
- **Scoring:** is `form_scorer` deterministic (same input → same output, no randomness)?
  Are `ANGLE_RANGES` loaded from JSON, never inlined? Are cues actually ≤ 8 words?
- **Smoothing & rep counter:** EMA α correct and per-connection; peak-detection params
  sane; any off-by-one or unit bugs (normalized vs. pixel coords, FPS assumptions).
- **Eval rigor:** do the `scripts/eval_*.py` measure what they claim? Any train/test
  leakage, hardcoded "pass" results, or metrics that can't be reproduced?

### 3. Security & secrets
Hunt for hardcoded API keys / JWT secrets (grep the whole tree + git history if cheap).
Confirm JWT is in `httpOnly, secure, samesite` cookies and **never** in localStorage or
the response body. Check the `DELETE /auth/account` path, IDOR on history endpoints
(does a user see only their own sessions?), CORS/`ALLOWED_ORIGINS`, rate limiting on
`/chat/stream`, and input validation on the WebSocket frame handler. Flag any frame
bytes / raw keypoints / tokens that get logged or written to disk.

### 4. Reliability & error handling
Bare `except`, swallowed errors, unhandled WebSocket disconnects, missing reconnect
backoff on the frontend, `/health/deep` returning 503 when Postgres/Redis are down (not
200), LLM-failure fallback path actually wired up, resource leaks (model memory, DB
sessions, file handles).

### 5. Performance & scalability
The end-to-end latency budget under load, blocking calls on the event loop, N+1 queries,
missing DB indexes, Redis usage, and what breaks when 100 users connect at once instead
of 1. Frontend: camera FPS cap, adaptive quality, memory growth over a long session.

### 6. Tests & verification
Real coverage vs. the claimed ≥80% on `app/analysis`. Are tests meaningful or do they
assert trivia? Do they use SQLite in-memory per the rule? Are external APIs (Gemini,
Qwen, Redis, YOLO) mocked, or do tests hit real services? What critical path has **zero**
tests (esp. the WS handler and scorer edge cases)?

### 7. Code quality & maintainability
Type coverage (`mypy --strict` realistic?), `ruff` cleanliness, dead code, copy-paste,
magic numbers, functions doing too much, `print()`/`logging.getLogger()` instead of
structlog. Frontend: `any` usage, prop-drilling, components over ~200 lines.

### 8. Product / startup readiness
What's the single biggest risk to shipping this to paying users? What's missing that a
real product needs (observability, migrations discipline, config management, graceful
degradation, a deploy story)? Be honest about what's "thesis-grade" vs. "product-grade."

## Step 2 — Output

Write the report to `docs/AUDIT_REPORT.md` with this structure:

```
# PoseCoach Audit — <date>

## Executive summary
3–5 sentences: overall health, and the single most important thing to fix.

## Top 10 findings (ranked)
A table: # | Severity (Critical/High/Med/Low) | Area | File:line | Issue | Fix

## Findings by dimension
The eight sections above, each a short list. Skip a dimension in one line if clean.

## What's done well
A short, honest list — don't invent praise.

## Recommended next 5 actions
Ordered, each with rough effort (S/M/L) and the metric it improves.
```

Keep prose tight. Tables and `file:line` over paragraphs. End by telling me the count of
Critical + High findings so I know how worried to be.

## What NOT to do
- Don't fix anything in this pass — audit only. I'll triage, then ask for fixes.
- Don't rewrite files to "test" a claim. Read and reason.
- Don't flag style preferences as if they were bugs. Separate "must fix" from "nice to have."
- Don't trust the CLAUDE.md claims at face value — verify the code actually matches them.
