# PoseCoach — Gemini & Antigravity Cheat Sheet

A one-pager for Ashwin's master's thesis workflow using **Gemini / Antigravity** alongside **Claude Code**.

---

## Daily Workflow (the loop)

1. Open `GYMVISION AI` in Antigravity IDE / CLI (`agy`) or Gemini CLI (`gemini`)
2. Open `GEMINI.local.md` (synced with `CLAUDE.local.md`) → pick the next unchecked prompt or stage
3. Run `/run-prompt NN` or `/run-fix <BRIEF.md>` → **prompt-planner** breaks the work into steps
4. Implement → run quality gate → fix until green
5. Run `/verify` → runs the verification suite for that prompt
6. Run `/checkpoint` → structured commit + push

---

## Your 3 Default Agents (available as subagents & skills)

| Agent | Skill / File | When to use |
|---|---|---|
| `prompt-planner` | `.agents/agents/prompt-planner.md` | Start every prompt here. Plans + sequences the work. |
| `code-reviewer` | `.agents/agents/code-reviewer.md` | Run before `/checkpoint`. Catches bugs, style, and YOLO26 issues. |
| `thesis-writer` | `.agents/agents/thesis-writer.md` | Drafting/editing thesis chapters and writeups. |

All 12 specialist agents (`api-architect`, `code-reviewer`, `colab-runner`, `dataset-engineer`, `devops-engineer`, `eval-analyst`, `frontend-engineer`, `ml-trainer`, `prompt-planner`, `rag-engineer`, `security-auditor`, `thesis-writer`) live in `.agents/agents/` (and `.gemini/agents/`) and are also exposed as skills (`agent-*`) in `.agents/skills/`.

---

## Your 9 Workflow Commands

```
/run-prompt NN    # Start prompt NN (01–10)
/run-fix BRIEF    # Execute an enhancement/fix brief from docs/enhancements/
/verify           # Run verification for the current prompt
/thesis-eval      # Full thesis evaluation pipeline
/checkpoint       # Commit with structured message
/debug            # Structured debugging session when something's broken
/run-colab        # Step-by-step P01 Colab guide
/sync-drive       # Sync P01 outputs from Google Drive to local
/setup-env        # Local dev environment setup from scratch
```

---

## Quality Gate (run before every `/checkpoint`)

```bash
ruff check app/ --fix       # lint + autofix
mypy app/ --strict          # type check
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
cd frontend && npx vitest run   # frontend unit tests
```

---

## Rules Files (auto-loaded every session from `.agents/rules/`)

| File | What it locks down |
|---|---|
| `.agents/rules/yolo26.md` | NMS-free predict, `keypoints.xyn` not `.boxes`, `end2end=False` BANNED, conf ≥ 0.5 gate, EMA α=0.6, run in executor |
| `.agents/rules/code-style.md` | Type hints everywhere, async-only DB/Redis, no raw SQL, structlog only, ruff + mypy strict |
| `.agents/rules/privacy-and-thesis.md` | Never log frames, JWT in httpOnly cookies, GDPR delete endpoint required |
| `.agents/rules/testing.md` | SQLite+aiosqlite in-memory only, `asyncio_mode="auto"`, respx for LLM mocks |
| `.agents/rules/dataset-training.md` | `nc=1`, 56-field labels, Fit3D `ANGLE_RANGES`, rep counter validation |
| `.agents/rules/colab-and-drive.md` | Colab T4/A100 training only, Drive paths, post-Colab sync |

---

## Where to Look for What

| Touching… | Read first |
|---|---|
| FastAPI route, model, async logic | `app/GEMINI.md` (or `app/CLAUDE.md`) |
| React component, hook, PWA config | `frontend/GEMINI.md` (or `frontend/CLAUDE.md`) |
| Pose keypoints, YOLO inference | `.agents/rules/yolo26.md` + `app/GEMINI.md` |
| Pytest, Vitest, Playwright | `tests/GEMINI.md` (or `tests/CLAUDE.md`) |
| Dataset prep, finetuning, eval | `scripts/GEMINI.md` (or `scripts/CLAUDE.md`) |
| Docker, NGINX, deploy | `deploy/GEMINI.md` + `nginx/GEMINI.md` |
| Personal env / progress / API keys | `GEMINI.local.md` / `CLAUDE.local.md` (gitignored) |
