# PoseCoach — Project Structure Optimization Report

**Date:** April 3, 2026
**Author:** Claude (optimization assistant)

---

## What Changed

### Root Folder Cleanup

15 loose files in the root (old proposals, duplicate PDFs, 7 Word/PowerPoint temp files) were moved to `archive/`. The root now contains only 4 clean directories: `archive/`, `files/` (original setup kit), `gymvision/` (old empty scaffold), and `posecoach/` (your working project).

### Unified Project Structure

The original setup had two disconnected pieces: an empty `gymvision/` scaffold with no code, and a complete Claude Code configuration buried in `files/posecoach-claude-code-setup/`. These have been merged into a single `posecoach/` directory that's ready for `cd posecoach && claude`.

### New Files Added

- **`.env.example`** — All 10 environment variables from CLAUDE.md with sensible defaults. Copy to `.env` before Prompt 02.
- **`.python-version`** — Pins Python 3.11.9 for pyenv.
- **`pyproject.toml`** — pytest config (async mode, 80% coverage gate on `app/analysis/`), ruff linter config, mypy strict mode with SQLAlchemy plugin.
- **`__init__.py` files** — In all 7 app subpackages so Python recognizes them as importable modules from day one.
- **Skeleton directories** — Every folder referenced in CLAUDE.md's file structure now exists: `app/` (7 subpackages), `frontend/src/{hooks,components}`, `alembic/versions/`, `scripts/`, `models/`, `data/{kaggle,keypoints,eval,thesis/latex}`, `tests/`, `e2e/`, `nginx/`, `deploy/`.

### Config Improvements

- **CLAUDE.local.md** — Filled in with your actual hardware specs from `wsl_verify.txt`: WSL2 Linux 6.6.87, RTX 3050 (4GB VRAM), CUDA 12.7, Python 3.12.3 system, Node v18.19.1.
- **`.gitignore`** — Added coverage files (`htmlcov/`, `.coverage`), Word temp files (`~$*`), Docker override, PyTorch exports (`*.onnx`), and editor swap files.

---

## Final Project Tree

```
GYMVISION AI/
├── archive/                    # Old docs, proposals, temp files (15 files)
├── files/                      # Original setup kit (reference copy)
├── gymvision/                  # Old empty scaffold (can be deleted)
└── posecoach/                  # YOUR WORKING PROJECT
    ├── CLAUDE.md               # Project memory (auto-loaded every session)
    ├── CLAUDE.local.md         # Your environment + progress tracker
    ├── README.md               # Setup guide for Claude Code
    ├── .gitignore              # Comprehensive ignore rules
    ├── .env.example            # Environment variable template
    ├── .python-version         # pyenv: Python 3.11.9
    ├── pyproject.toml          # pytest + ruff + mypy config
    │
    ├── .claude/                # Claude Code configuration
    │   ├── settings.json       # Tool permissions
    │   ├── rules/              # Always-loaded rules (3 files)
    │   ├── commands/           # /run-prompt, /verify, /thesis-eval
    │   ├── skills/             # form-scorer, rag-chatbot, yolo-eval
    │   └── agents/             # code-reviewer, prompt-planner
    │
    ├── docs/                   # Prompt guide PDF
    ├── app/                    # FastAPI backend (7 subpackages, all with __init__.py)
    │   ├── auth/               # JWT auth + rate limiting (Prompt 06)
    │   ├── history/            # Workout session CRUD (Prompt 06)
    │   ├── inference/          # WebSocket, YOLO predictor (Prompt 03)
    │   ├── analysis/           # Angle calc, form scorer, rep counter (Prompt 03)
    │   ├── chatbot/knowledge/  # RAG + Gemini + 8 knowledge files (Prompt 05)
    │   └── middleware/         # Security headers, request ID, timing (Prompt 08)
    │
    ├── frontend/src/           # React PWA (Prompt 04)
    │   ├── components/
    │   └── hooks/              # Custom WebSocket/camera hooks
    │
    ├── alembic/versions/       # Database migrations (Prompt 02)
    ├── scripts/                # Eval scripts, dataset tools (Prompt 01, 10)
    ├── models/                 # Fine-tuned YOLO weights (.gitignored)
    ├── data/                   # Datasets, eval results, thesis exports (.gitignored)
    ├── tests/                  # Pytest backend tests (Prompt 07)
    ├── e2e/                    # Playwright E2E tests (Prompt 07)
    ├── nginx/                  # Production NGINX config (Prompt 09)
    └── deploy/                 # docker-compose.prod.yml (Prompt 09)
```

---

## Scaffold Audit: What's Strong

The Claude Code setup is well-designed. Specific strengths worth noting:

1. **YOLO26 guardrails** are critical. The `yolo26.md` rule file prevents the single most common mistake (calling NMS on an NMS-free model). This alone will save hours of debugging.

2. **The 10-prompt sequential execution model** with `/run-prompt` is smart. Each prompt builds on the last, and the prompt-planner agent prevents mid-implementation surprises.

3. **Thesis metric gates** with hard exit codes (`eval_*.py` scripts) mean you can't accidentally ship a build that fails your thesis criteria.

4. **Privacy rules** are non-negotiable and correctly placed in `rules/` (auto-loaded every session), not just documented in CLAUDE.md.

5. **The code-reviewer agent** catches security, YOLO26, and thesis alignment issues — acting as a second pair of eyes after every prompt.

---

## Scaffold Audit: What to Watch

1. **Python version mismatch** — Your system Python is 3.12.3 but the project requires 3.11.9. Before Prompt 01, run: `pyenv install 3.11.9 && pyenv local 3.11.9` inside the `posecoach/` folder.

2. **No `requirements.txt` yet** — This is intentional (Prompt 02 creates it), but keep in mind that `pip install` without a pinned requirements file means you'll need to freeze versions after infrastructure setup.

3. **GitHub Actions are empty** — `.github/workflows/` exists in the old scaffold but isn't in posecoach yet. Prompt 09 handles this. Don't create CI/CD before then.

4. **ChromaDB persistence** — The fallback if `CHROMA_PATH` env var is missing is an in-memory store that loses data on restart. Double-check your `.env` includes this before Prompt 05.

5. **RTX 3050 VRAM (4GB)** — Enough for `yolo26n-pose.pt` (nano) but tight for `yolo26x-pose.pt` (extra-large). During development, stick with the nano model. The `torch.cuda.empty_cache()` every 100 frames rule in yolo26.md is essential for your hardware.

---

## Getting Started

```bash
cd "GYMVISION AI/posecoach"
cp .env.example .env          # Fill in your API keys
pyenv install 3.11.9          # If not already installed
pyenv local 3.11.9
git init
git add .
git commit -m "Initial project scaffold with Claude Code configuration"
claude                        # Start Claude Code
# Then: /run-prompt 01
```
