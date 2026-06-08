# PoseCoach — Fix Pass (Quick Wins from the Audit)

> Paste this into Claude Code at the repo root. It fixes the 4 low-risk, high-payoff
> findings from `docs/AUDIT_REPORT.md`. It does **NOT** touch the concurrency rework
> (finding #1) — that's a separate, careful session.

---

## Role & rules

You are a senior backend engineer making **surgical, minimal** fixes. Follow these rules:

1. **Read `CLAUDE.md` and `.claude/rules/` first.** Obey every project invariant
   (structlog only, absolute imports, `async def` routes, no bare except, constants in
   UPPER_SNAKE_CASE, Google-style docstrings, ruff + mypy --strict must pass).
2. **This repo lives in OneDrive — Edit/Write can truncate files.** Prefer small,
   targeted edits. After each file change, verify it's intact: `wc -l <file>` and
   `python -c "import ast; ast.parse(open('<file>').read())"`. If a file looks
   truncated, recover with `git show HEAD:<path>` and redo the edit.
3. **Show me a plan + diffs BEFORE applying.** For each of the 4 fixes: state the file,
   the change, and a unified diff. Pause for my "go" before writing. Then apply all,
   and run the quality gate at the end.
4. **One concern per fix. No drive-by refactors.** If you spot something else, note it
   in a "Deferred" list — don't fix it.
5. **Add or update a test for each behavioral change** (frame-size cap, anon-connection
   cap). Tests use SQLite in-memory; mock Gemini/Qwen/Redis/Chroma/YOLO per the rules.

## The 4 fixes

### Fix 1 — Ruff red on main (finding #10, trivial)
`app/api/v1/chat.py:24` imports `FALLBACK_MESSAGE` but never uses it. Remove the unused
import (or use it if it was meant to be wired). Then confirm `ruff check app/` is clean.

### Fix 2 — Cap frame payload size (finding #2)
Unbounded base64 `frame` lets one oversized payload stall the single worker.
- **WS handler** `app/api/v1/ws_inference.py:206`: before `b64decode`, reject any frame
  whose byte length exceeds a module-level `MAX_FRAME_BYTES` constant (set ~256 KB —
  pick the value and add a comment on the reasoning). On violation, send a structured
  error message to the client and skip the frame (don't kill the socket).
- **Chat** `app/api/v1/chat.py`: add a `max_length` to the optional `frame` field on
  `ChatRequest` (Pydantic), consistent with the 2000-char `query` cap.
- Log violations with structlog (no frame bytes in the log). Add tests for both:
  an over-limit frame is rejected, an at-limit frame passes.

### Fix 3 — Migrations in the deployed image (finding #4)
The root `Dockerfile` (what HF Spaces builds) starts uvicorn with no migration step,
unlike the compose files. Make the deployed container run `alembic upgrade head` before
the server starts — via the `CMD` or a small entrypoint script. Match how the compose
files already do it. Don't change app code. Note in the diff that this assumes the DB is
reachable at container start (it is, per the compose topology).

### Fix 4 — Meter anonymous WebSocket connections (finding #3)
`app/api/v1/ws_inference.py:148`: authenticated users have a per-user connection guard,
but anonymous users (`conn_guard_key = None`) are unlimited, and there's no global cap.
- Add a **global active-connection ceiling** (module-level constant, env-overridable)
  enforced for every socket.
- Add an **IP-based guard for anonymous sockets** (limit concurrent connections per
  client IP), reusing the existing guard mechanism's pattern if there is one.
- On limit exceeded: close the socket with a clear close code/reason; log with structlog.
- Add a test: opening more than the cap returns the rejection path.

## After applying — quality gate (must pass)

```bash
ruff check app/ --fix
mypy app/ --strict
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
```

Report the results of all three. If anything fails, fix it before finishing.

## Commit

Use the project format, one commit per fix (or one grouped commit if I say so):

```
[P15] fix: <short description>

- bullet
```

## Out of scope (do NOT do in this pass)
- Finding #1 (concurrency / worker sizing / load test) — separate session.
- Findings #6, #8 (thesis-rigor benchmarks/grading) — deprioritized; project is now a
  product, not a thesis.
- #5 doc-vs-code conf-gate, #7 CSP, #9 stale model names — list them as Deferred; don't fix.
- Any refactor of the ~390-line WS function. Note it, leave it.
