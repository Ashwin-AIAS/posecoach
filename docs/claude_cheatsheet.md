# PoseCoach — Claude Code Cheat Sheet

A one-pager for Ashwin's master's thesis workflow. Print this. Pin it.

---

## Daily Workflow (the loop)

1. `cd posecoach && claude`
2. Open `CLAUDE.local.md` → pick the next unchecked prompt (P01 → P10)
3. `/run-prompt NN` → **prompt-planner** breaks the work into steps
4. Implement → run quality gate → fix until green
5. `/verify` → runs the verification command for that prompt
6. `/checkpoint` → structured commit + push

---

## Your 3 Default Agents

| Agent | When to use |
|---|---|
| `prompt-planner` | Start every prompt here. Plans + sequences the work. |
| `code-reviewer` | Run before `/checkpoint`. Catches bugs and style issues. |
| `thesis-writer` | Drafting/editing thesis chapters and writeups. |

You have 96 other specialized agents (security-auditor, performance-engineer, etc.). **Don't memorize them.** When stuck, just ask: *"Is there an agent that can help with [problem]?"*

---

## Your 5 Default Commands

```
/run-prompt NN    # Start prompt NN (01–10)
/verify           # Run verification for the current prompt
/thesis-eval      # Full thesis evaluation pipeline
/checkpoint       # Commit with structured message
/debug            # When something's broken
```

---

## Quality Gate (run before every `/checkpoint`)

```bash
ruff check app/ --fix       # lint + autofix
mypy app/ --strict          # type check
pytest                      # all tests pass + ≥80% coverage on app/analysis
cd frontend && npx vitest run   # frontend unit tests
```

---

## Rules Files (auto-loaded every session)

| File | What it locks down |
|---|---|
| `.claude/rules/yolo26.md` | NMS-free predict, `keypoints.xyn` not `.boxes`, conf ≥ 0.5 gate, EMA α=0.6, run in executor |
| `.claude/rules/code-style.md` | Type hints everywhere, async-only DB/Redis, no raw SQL, structlog only, ruff + mypy strict |
| `.claude/rules/privacy-and-thesis.md` | Never log frames, JWT in httpOnly cookies, GDPR delete endpoint required |

---

## Where to Look for What

| Touching… | Read first |
|---|---|
| FastAPI route, model, async logic | `app/CLAUDE.md` |
| React component, hook, PWA config | `frontend/CLAUDE.md` |
| Pose keypoints, YOLO inference | `.claude/rules/yolo26.md` + `app/CLAUDE.md` |
| Pytest, Vitest, Playwright | `tests/CLAUDE.md` |
| Dataset prep, finetuning, eval | `scripts/CLAUDE.md` |
| Docker, NGINX, deploy | `deploy/CLAUDE.md` + `nginx/CLAUDE.md` |
| Personal env / progress / API keys | `CLAUDE.local.md` (gitignored) |

---

## Top Gotchas (memorize these — they will bite)

- **YOLO26 is NMS-free.** Never call NMS after `model.predict()`.
- **Use `results[0].keypoints.xyn`** — not `.boxes`, not `.xy`.
- **Camera in frontend → `requestAnimationFrame`**, never `setInterval`. Cap at 15 FPS.
- **`<video>` needs `playsInline`** on iOS Safari or it goes fullscreen.
- **JWT → httpOnly cookies only.** Never `localStorage`.
- **Frames stay in memory.** Never write JPEGs to disk (privacy + thesis ethics).
- **Model lives in `app.state.model`** from FastAPI lifespan. Never load per-request.
- **Run `model.predict` in `run_in_executor`.** Never directly on the async loop.
- **`torch.cuda.empty_cache()` every 100 frames** — RTX 3050 has 4 GB VRAM.
- **`/health/deep` returns 503** (not 200) when any dependency is down.

---

## Prompt Sequence (the 10 thesis chunks)

```
P01  Dataset Prep & Finetuning      → scripts/download_kaggle.py, scripts/finetune_yolo.py
P02  Infrastructure                  → docker-compose.yml, app/main.py, alembic/
P03  WebSocket + Inference           → app/inference/, app/analysis/
P04  React PWA                       → frontend/
P05  RAG Chatbot                     → app/chatbot/
P06  Auth + History                  → app/auth/, app/history/
P07  Test Suite                      → tests/, e2e/
P08  Observability                   → app/logging_config.py, app/metrics.py
P09  Production Hardening            → nginx/, deploy/, .github/workflows/
P10  Thesis Evaluation               → scripts/eval_*.py, data/thesis/
```

Execute strictly in order — each depends on the previous.

---

## When You're Stuck (escalation ladder)

1. Ask Claude: *"Is there a rule file or skill that covers this?"*
2. Ask Claude: *"Is there an agent that handles [problem]?"*
3. Run `/debug` — structured debugging session.
4. Read the relevant subfolder `CLAUDE.md` from the table above.
5. Last resort: ask Claude to `git log --oneline -- <file>` and explain why the code is the way it is.

---

## Weekly Hygiene (Sunday evenings, 5 min)

- `git commit` your `.claude/` directory — snapshot in case claude-flow updates break things
- Update progress checkboxes in `CLAUDE.local.md`
- Make sure `requirements.txt` and `frontend/package.json` are current
- Push to GitHub (off-machine backup before the week starts)

---

## Things to Tell Me at the Start of a New Session

If you've been away for a few days, just paste:
> *"I'm picking up PoseCoach work. Read `posecoach/CLAUDE.md`, my progress in `CLAUDE.local.md`, and tell me where I left off."*

The auto-memory hook handles most of this, but a fresh prompt makes sure context loads correctly.

---

*Generated 2026-04-30. Update when your workflow changes.*
