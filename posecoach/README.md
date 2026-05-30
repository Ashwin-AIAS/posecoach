---
title: PoseCoach API
emoji: 🏋️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
short_description: Real-time AI gym form correction backend (YOLO26 + RAG)
---

# PoseCoach — Claude Code Setup Guide

## Prerequisites

1. **Claude Pro or Max subscription** (or Anthropic API key)
2. **Claude Code installed:**
   ```bash
   # macOS / Linux
   curl -fsSL https://claude.ai/install.sh | bash

   # Windows PowerShell
   irm https://claude.ai/install.ps1 | iex
   ```
3. **Verify:**
   ```bash
   claude --version
   claude doctor
   ```

---

## Project Structure

The `.claude/` folder gives Claude complete context about this codebase every session.

```
posecoach/
├── CLAUDE.md                         # Project memory (auto-loaded every session)
├── CLAUDE.local.md                   # Personal overrides + progress tracker (gitignored)
├── .env.example                      # All env vars documented here
│
├── .claude/
│   ├── settings.json                 # Tool permissions (no hooks — lean setup)
│   │
│   ├── rules/                        # Auto-loaded every session (small, targeted)
│   │   ├── yolo26.md                 # YOLO26-Pose quirks: NMS-free, end2end=False ban, fuse()
│   │   ├── code-style.md             # Python 3.11, ruff, mypy strict, TypeScript strict
│   │   ├── privacy-and-thesis.md     # JWT cookies, no frame logging, GDPR, API key rules
│   │   ├── testing.md                # SQLite in-memory, asyncio_mode=auto, respx for APIs
│   │   ├── dataset-training.md       # nc=1, label format, ANGLE_RANGES, two-stage finetune
│   │   └── colab-and-drive.md        # When to use Colab vs local, Drive paths, sync checklist
│   │
│   ├── commands/                     # Slash commands (type /command in Claude Code)
│   │   ├── run-prompt.md             # /run-prompt 03 — execute a prompt end-to-end
│   │   ├── verify.md                 # /verify — ruff + mypy + pytest + vitest + docker build
│   │   ├── checkpoint.md             # /checkpoint — pre-flight checks + structured git commit
│   │   ├── debug.md                  # /debug — classify, isolate, fix, verify
│   │   ├── thesis-eval.md            # /thesis-eval — run all 6 eval scripts in order
│   │   ├── run-colab.md              # /run-colab — step-by-step Colab training guide
│   │   ├── sync-drive.md             # /sync-drive — download weights + results from Drive
│   │   └── setup-env.md              # /setup-env — first-time environment bootstrap
│   │
│   ├── skills/                       # Auto-invoked when description matches the task
│   │   ├── p01-dataset-prep/         # Kaggle download, Fit3D, two-stage YOLO finetune on Colab
│   │   ├── p02-infrastructure/       # Docker, FastAPI, PostgreSQL, Redis, Alembic
│   │   ├── p03-websocket-inference/  # WebSocket, YOLO26 executor pattern, EMA smoother
│   │   ├── p04-react-pwa/            # React 18, Vite, Tailwind, camera, skeleton overlay
│   │   ├── p05-rag-chatbot/          # ChromaDB, Gemini 2.0 Flash, Qwen 3.6 routing, SSE
│   │   ├── p06-auth-history/         # JWT cookies, workout history, keypoints_data JSON
│   │   ├── p07-test-suite/           # Pytest, Vitest, Playwright, coverage targets
│   │   ├── p08-observability/        # Prometheus + Grafana dashboards (base metrics exist)
│   │   ├── p09-production-hardening/ # Rate limiting, NGINX, load test (security headers exist)
│   │   └── p10-thesis-evaluation/    # 6 eval scripts, SUS study, Qwen VLM judge, LaTeX tables
│   │
│   └── agents/                       # Specialist sub-agents (@mention in Claude Code)
│       ├── prompt-planner.md         # Plans prompt execution before any coding starts
│       ├── code-reviewer.md          # YOLO26 rules, security, thesis compliance, test coverage
│       ├── ml-trainer.md             # Two-stage finetune, Colab workflow, model export
│       ├── dataset-engineer.md       # Kaggle labels, Fit3D pipeline, nc=1, YOLO format
│       ├── api-architect.md          # FastAPI lifespan, WebSocket, SQLAlchemy, Alembic
│       ├── frontend-engineer.md      # React PWA, camera pipeline, WebSocket client, Tailwind
│       ├── rag-engineer.md           # ChromaDB, Gemini + Qwen routing, SSE streaming
│       ├── security-auditor.md       # JWT audit, GDPR, security headers, API key scan
│       ├── devops-engineer.md        # Docker Compose, NGINX, Render/Vercel, load testing
│       ├── colab-runner.md           # Colab T4 workflow, Drive sync, common errors
│       ├── eval-analyst.md           # All 5 thesis metrics, SUS protocol, Qwen judge
│       └── thesis-writer.md          # Thesis chapters, BibTeX citations, evaluation tables
│
├── app/                              # FastAPI backend (Python 3.11)
├── frontend/                         # React PWA (Vite + TypeScript)
├── alembic/                          # Database migrations
├── scripts/                          # eval_*.py + dataset tools
├── tests/                            # Pytest (SQLite in-memory)
├── e2e/                              # Playwright E2E tests
├── nginx/                            # Production NGINX config
├── deploy/                           # docker-compose.prod.yml + monitoring
└── data/                             # Datasets, eval results, thesis_tables/
```

---

## First-Time Setup

```bash
cd posecoach
/setup-env        # pyenv 3.11.9 → venv → pip install → docker services → alembic
```

Then open Claude Code:
```bash
claude
```

Claude automatically reads `CLAUDE.md` and all 6 rules files. No other configuration needed.

---

## Prompt-by-Prompt Workflow

Each prompt is a discrete deliverable. Work through them in order.

```
1. @prompt-planner Plan execution of Prompt 03
2. Review the plan, ask questions if unclear
3. /run-prompt 03
4. Implement all deliverables
5. @code-reviewer Review the changes
6. /verify
7. /checkpoint
8. Mark P03 done in CLAUDE.local.md
```

### Quick Start for Current Prompt (P03 — WebSocket + Inference)
```
/run-prompt 03
```

---

## Custom Slash Commands

| Command | What It Does |
|---|---|
| `/run-prompt 03` | Execute Prompt 03 end-to-end (reads skill → plans → implements → verifies) |
| `/verify` | Full quality gate: ruff + mypy + pytest + vitest + docker build |
| `/checkpoint` | Pre-flight secret check + structured git commit |
| `/debug` | Classify error by layer → isolate → hypothesize → fix → verify |
| `/thesis-eval` | Run all 6 eval scripts in order, report results vs. targets |
| `/run-colab` | Step-by-step guide to run training on Colab T4 |
| `/sync-drive` | Download weights + eval results from Google Drive to local |
| `/setup-env` | First-time environment setup (pyenv, venv, docker, alembic) |

### Built-in Claude Code Commands
| Command | What It Does |
|---|---|
| `/compact` | Compress conversation history (run at ~50% context) |
| `/clear` | Reset conversation (start fresh) |
| `/model` | Switch between Sonnet and Opus |
| `/memory` | Edit CLAUDE.md from inside Claude Code |

---

## Specialist Agents

Invoke with `@agent-name` in Claude Code:

| Agent | When to Use |
|---|---|
| `@prompt-planner` | Before starting any prompt — creates a subtask plan |
| `@code-reviewer` | Before `/checkpoint` — checks YOLO26 rules, security, thesis compliance |
| `@ml-trainer` | Anything about finetune runs, Colab, ONNX export, model weights |
| `@dataset-engineer` | Label format, Kaggle download, Fit3D pipeline, nc=1 issues |
| `@api-architect` | FastAPI routes, SQLAlchemy models, Alembic migrations, lifespan |
| `@frontend-engineer` | React PWA, camera pipeline, WebSocket client, skeleton overlay |
| `@rag-engineer` | ChromaDB, Gemini/Qwen routing, SSE streaming |
| `@security-auditor` | JWT audit, GDPR compliance, security headers, hardcoded secrets scan |
| `@devops-engineer` | Docker Compose, NGINX, Render/Vercel deployment, load tests |
| `@colab-runner` | Colab T4 issues, Drive paths, file transfer, common training errors |
| `@eval-analyst` | Thesis metrics, SUS user study, Qwen VLM judge, LaTeX tables |
| `@thesis-writer` | Writing thesis chapters, eval tables, BibTeX citations |

---

## Thesis Metrics at a Glance

| Metric | Target |
|---|---|
| YOLO mAP@0.5 | > 0.70 |
| Inference latency p95 | < 100ms |
| Form score consistency | < 5% variance (20 identical inputs) |
| Chatbot accuracy | ≥ 80% on 50 Q&A pairs |
| User study SUS score | ≥ 70, n ≥ 10 participants |
| Test coverage (app/analysis) | ≥ 80% |

---

## Long-Session Tips

- **`/compact` at ~50% context** — Claude gets less accurate in very long conversations
- **One session per prompt** — each prompt is self-contained; fresh context helps
- **`/clear` if Claude seems confused** — cheaper than debugging context drift
- **End mid-session cleanly** — ask Claude to write `progress.md` before stopping

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `claude: command not found` | Re-run the install script |
| Auth issues | Run `claude` and follow browser login prompts |
| Claude ignores CLAUDE.md rules | Verify file is in project root; run `/memory` |
| Skills not triggering | Invoke the relevant prompt: `/run-prompt 03` |
| Permission denied on bash | Check `.claude/settings.json` allowlist |
| Context too long | Run `/compact` or `/clear` |
| Training OOM on Colab | Switch runtime to T4; `/run-colab` for guidance |
| YOLO keypoints all wrong | Check `end2end=False` is ABSENT from all predict calls |
