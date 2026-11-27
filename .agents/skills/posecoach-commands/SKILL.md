---
name: posecoach-commands
description: >-
  PoseCoach project workflow commands (/checkpoint, /debug, /run-colab, /run-fix, /run-prompt,
  /setup-env, /sync-drive, /thesis-eval, /verify) mirrored from .claude/commands/ into .agents/commands/.
  Activate this skill whenever the user invokes any of these slash commands or asks to verify,
  checkpoint, run a prompt, run a fix brief, debug, or run thesis evaluations.
---

# PoseCoach Workflow Commands (`.agents/commands/`)

When the user asks to run any of the PoseCoach workflow commands below, read and follow the corresponding runbook in `.agents/commands/`:

| Command | Runbook File | Purpose |
| :--- | :--- | :--- |
| `/run-prompt <NN>` | [.agents/commands/run-prompt.md](../../commands/run-prompt.md) | Load `.agents/skills/p<NN>-*/SKILL.md`, plan with `prompt-planner`, implement subtask-by-subtask, review with `code-reviewer`, and run quality gates. |
| `/run-fix <BRIEF.md>` | [.agents/commands/run-fix.md](../../commands/run-fix.md) | Execute an enhancement/fix brief from `docs/enhancements/` or `docs/prompts/` end-to-end with planning, phase gates, and code review. |
| `/verify` | [.agents/commands/verify.md](../../commands/verify.md) | Run full backend (`ruff`, `mypy --strict`, `pytest --cov=app/analysis --cov-fail-under=80`) and frontend (`tsc`, `eslint`, `vitest`) verification suite. |
| `/checkpoint` | [.agents/commands/checkpoint.md](../../commands/checkpoint.md) | Pre-flight secret scan, format commit `[P0X] type: description`, get user approval, commit, and update `GEMINI.local.md` & `CLAUDE.local.md`. |
| `/debug` | [.agents/commands/debug.md](../../commands/debug.md) | Structured 7-step debugging workflow (Reproduce → Classify → Isolate → Hypothesize → Fix → Verify → Quality Gate). |
| `/thesis-eval` | [.agents/commands/thesis-eval.md](../../commands/thesis-eval.md) | Execute all 6 thesis evaluation scripts (`eval_yolo.py`, `eval_latency.py`, `eval_form_consistency.py`, `eval_chatbot.py`, `eval_user_study.py`, `export_thesis_tables.py`). |
| `/run-colab` | [.agents/commands/run-colab.md](../../commands/run-colab.md) | Step-by-step instructions to run `PoseCoach_P01_Colab.ipynb` on Google Colab T4/A100. |
| `/sync-drive` | [.agents/commands/sync-drive.md](../../commands/sync-drive.md) | Sync trained YOLO weights, ONNX export, Fit3D `angle_ranges.json`, and eval JSONs from Google Drive to local paths. |
| `/setup-env` | [.agents/commands/setup-env.md](../../commands/setup-env.md) | Set up Python 3.11.9 venv, `.env`, Docker Postgres/Redis, Alembic migrations, FastAPI, and Vite frontend from scratch. |
