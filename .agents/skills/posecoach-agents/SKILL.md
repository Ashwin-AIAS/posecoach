---
name: posecoach-agents
description: >-
  PoseCoach specialist agent roster (12 domain agents mirrored from .claude/agents/ into .agents/agents/).
  Activate this skill whenever you need to run or spawn a specialist agent (api-architect, code-reviewer,
  colab-runner, dataset-engineer, devops-engineer, eval-analyst, frontend-engineer, ml-trainer,
  prompt-planner, rag-engineer, security-auditor, thesis-writer) or execute multi-role Project Leader workflows.
---

# PoseCoach Specialist Agents (`.agents/agents/`)

This skill connects Gemini / Antigravity to the 12 PoseCoach specialist agents located in `.agents/agents/` (mirrored from `.claude/agents/`).

## Available Specialist Agents

| Agent Name | File Path | When to Use |
| :--- | :--- | :--- |
| `prompt-planner` | [.agents/agents/prompt-planner.md](../../agents/prompt-planner.md) | Start here before working on any prompt (P01–P29). Produces a subtask plan, top 3 risks, and thesis metric mapping. |
| `code-reviewer` | [.agents/agents/code-reviewer.md](../../agents/code-reviewer.md) | Run before every `/checkpoint` commit. Audits YOLO26 rules (`end2end=False` auto-BLOCK), privacy rules, structlog, and coverage. |
| `api-architect` | [.agents/agents/api-architect.md](../../agents/api-architect.md) | FastAPI routes, WebSocket inference (`run_in_executor`), async SQLAlchemy, Alembic migrations, lifespan management. |
| `ml-trainer` | [.agents/agents/ml-trainer.md](../../agents/ml-trainer.md) | YOLO26-Pose two-stage finetuning, AdamW vs MuSGD, `model.fuse()` before ONNX export, OKS-mAP & latency budgets. |
| `dataset-engineer` | [.agents/agents/dataset-engineer.md](../../agents/dataset-engineer.md) | Kaggle workout videos + Fit3D mocap pipeline, 56-field YOLO pose labels, `nc=1`, stratified clip-ID split, `ANGLE_RANGES`. |
| `colab-runner` | [.agents/agents/colab-runner.md](../../agents/colab-runner.md) | Running `PoseCoach_P01_Colab.ipynb` on Colab T4/A100, Google Drive paths (`MyDrive/GYMVISION AI/`), Drive-to-local sync. |
| `frontend-engineer` | [.agents/agents/frontend-engineer.md](../../agents/frontend-engineer.md) | React 18 + TypeScript + Vite + Tailwind PWA, `requestAnimationFrame` camera capture, COCO 17-point canvas overlay, Vitest/Playwright. |
| `rag-engineer` | [.agents/agents/rag-engineer.md](../../agents/rag-engineer.md) | Dual-LLM chatbot: Gemini 3.5 Flash (`google-genai` SDK) + Qwen 3.6 (OpenRouter), ChromaDB RAG, Tavily web fallback, SSE streaming. |
| `security-auditor` | [.agents/agents/security-auditor.md](../../agents/security-auditor.md) | JWT in `httpOnly` cookies (never `localStorage`), GDPR frame privacy (in-memory only), 6 security headers, rate limiting. |
| `devops-engineer` | [.agents/agents/devops-engineer.md](../../agents/devops-engineer.md) | Docker Compose, NGINX WebSocket upgrade headers, Render / Hugging Face Space (`hf`) / Vercel / Modal deployments, Locust load tests. |
| `eval-analyst` | [.agents/agents/eval-analyst.md](../../agents/eval-analyst.md) | Thesis evaluation pipeline (`scripts/eval_*.py`), OKS-mAP, latency p95, form score variance, chatbot accuracy, SUS user study. |
| `thesis-writer` | [.agents/agents/thesis-writer.md](../../agents/thesis-writer.md) | Drafting MSc thesis chapters (§1–§7), LaTeX results tables, methodology descriptions, and BibTeX citations (YOLO26, RLE). |

## How to Use in Antigravity / Gemini

1. **In-Conversation Specialist Persona**: Read the corresponding `.agents/agents/<agent-name>.md` file and execute the task following its checklist and domain rules under a `## <Agent Name>` heading.
2. **Spawning an Autonomous Subagent**: Call `define_subagent` using the `name`, `description`, and markdown body from `.agents/agents/<agent-name>.md` as `SystemPrompt`, then call `invoke_subagent` to run it in parallel or isolated context.
