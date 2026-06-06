# PoseCoach — Project Memory

## What This Is
PoseCoach is a real-time Computer Vision AI system for gym exercise form correction.
It is a **thesis project** — every feature must map to a thesis evaluation metric.
Execute prompts **strictly in order** (P01 → P10). Each depends on the previous.

## Current Progress
See `CLAUDE.local.md` for personal progress checkboxes.
**P01–P10 complete. Post-gym-test improvements P11–P14 complete** (reference video
as an on-demand section, rep-counter overhaul, exercise-verification + stricter
scoring, RAG expansion + web fallback). See `IMPROVEMENT_PLAN_P11-P14.md`.

## Tech Stack
- **Backend:** FastAPI + PostgreSQL + Redis + Alembic (Python 3.11)
- **CV Model:** YOLO26-Pose (`yolo26n-pose.pt` dev / `yolo26x-pose.pt` prod) via Ultralytics
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS (PWA)
- **AI Coaching:** Gemini 3.5 Flash + ChromaDB (RAG) + SSE streaming
- **Secondary LLM:** Qwen 3.6 via OpenRouter API (P05 visual queries + P10 VLM judge)
- **Auth:** JWT (HS256) in httpOnly cookies — NEVER localStorage
- **Testing:** Pytest + Vitest + Playwright
- **Deploy:** Docker + NGINX + Vercel (frontend) + Render (API) + Modal (GPU)

## Build & Run Commands
```bash
# Start all services
docker-compose up --build

# Backend tests (≥80% coverage on app/analysis required)
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80

# Frontend tests
cd frontend && npx vitest run

# E2E tests
cd frontend && npx playwright test --headed

# Alembic migrations
alembic upgrade head

# Ingest RAG knowledge base
python -m app.chatbot.ingest

# Full thesis evaluation pipeline (P10)
python scripts/eval_yolo.py
python scripts/eval_latency.py
python scripts/eval_form_consistency.py
python scripts/eval_chatbot.py
python scripts/eval_user_study.py
python scripts/export_thesis_tables.py
```

## Critical Architecture Rules

### YOLO26 — Do NOT Break These
- YOLO26 is **NMS-free end-to-end** — NEVER call NMS after `model.predict()`
- **`end2end=False` is BANNED** — it silently switches to the NMS one-to-many head and breaks keypoint parsing. Auto-BLOCK in code review.
- Access keypoints via `results[0].keypoints.xyn` — shape `(num_persons, 17, 2)` normalized. Never `.boxes` for pose.
- Confidence gate: skip any joint where `kp_conf[i] < 0.5`
- Model loaded ONCE in FastAPI lifespan → `app.state.model` — never per-request
- Run inference in executor: `await loop.run_in_executor(executor, predict)` — NEVER on async loop
- `torch.cuda.empty_cache()` every 100 frames to prevent OOM
- ONNX export: call `model.fuse()` BEFORE `model.export()` to remove auxiliary head
- `nc=1` in all `dataset.yaml` files — no exercise classification inside the model

### Keypoint Smoothing (P03 deliverable)
- `app/inference/smoother.py` — EMA smoother for raw keypoints, α=0.6
- `app/analysis/score_smoother.py` — EMA smoother for scalar form score, α=0.6
- One smoother instance per WebSocket connection. Call `.reset()` on disconnect.

### Form Scoring
- 7 supported exercises: `squat, deadlift, curl, bench, ohp, lunge, plank`
- Angle ranges in `ANGLE_RANGES` dict loaded from `app/analysis/angle_ranges.json` — never inline
- Cue strings: max 8 words, plain English, no jargon
- Scorer must be deterministic — same input → same output (no randomness)
- Form score consistency target: **< 5% variance** across identical inputs

### Logging (use structlog everywhere)
```python
import structlog
logger = structlog.get_logger(__name__)
logger.info("inference_complete", latency_ms=23.4, exercise="squat")
```
- **NEVER** `print()` or `logging.getLogger()` — always `structlog.get_logger()`
- Never log: frames, raw keypoint arrays, passwords, JWT tokens, PII beyond user_id

### Frontend
- PWA with `manifest.json` — must be installable on mobile
- Camera: `requestAnimationFrame` not `setInterval`, max 15 FPS
- Adaptive quality: reduce JPEG quality/resolution on high RTT
- WebSocket reconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s)
- `visibilitychange` listener: stop camera on hidden, restart on visible

### RAG Chatbot (P05)
- **Smart routing:** visual queries (with frame snapshot) → Qwen 3.6 via OpenRouter; text-only → Gemini 3.5 Flash (cheaper)
- Uses the unified `google-genai` SDK (NOT the retired `google-generativeai`). Model name is env-configurable via `GEMINI_MODEL` (default `gemini-3.5-flash`). gemini-2.0-flash was retired 2026-06-01 — never use it.
- SSE streaming for chat — NOT WebSocket
- Rate limit: 10 req/min on `/chat/stream` (Gemini free tier is 15/min)
- Fallback if LLM fails: `build_smart_fallback()` in `prompts.py` — serves retrieved KB context or exercise-specific tips; generic message is last resort only
- ChromaDB `persist_directory` from `CHROMA_PATH` env var

### Database & Schema
- `app/models.py` — ALL ORM models (User + WorkoutSession) live here, flat file
- **WorkoutSession** stores `keypoints_data` as a JSON column — no separate `pose_snapshots` table
- Alembic for all schema changes — never `Base.metadata.create_all()`
- Tests use **SQLite in-memory** (`sqlite+aiosqlite:///:memory:`) — NEVER real Postgres in tests

### Privacy & Ethics (Thesis Requirement)
- JPEG frames NEVER written to disk — process in memory, discard after inference
- JWT in `httpOnly=True, secure=True` cookie — NEVER in response body, NEVER in localStorage
- API keys in env vars only — NEVER hardcoded (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`)
- Logging must NEVER include: passwords, JWT tokens, frame bytes, or PII beyond user_id
- `DELETE /auth/account` endpoint required (GDPR Article 17)

## File Structure
```
posecoach/
├── app/
│   ├── main.py              # FastAPI factory + lifespan (model, executor, Redis loaded here)
│   ├── db.py                # Async SQLAlchemy engine + Base
│   ├── models.py            # User + WorkoutSession ORM models (flat, not in db/models/)
│   ├── cache.py             # Redis async client
│   ├── core/
│   │   ├── config.py        # pydantic-settings (env vars)
│   │   ├── security.py      # JWT creation + verification
│   │   └── logging_config.py  # structlog JSON setup (EXISTS — do not recreate)
│   ├── api/v1/
│   │   ├── auth.py          # login / logout / me
│   │   ├── history.py       # workout session history
│   │   ├── chat.py          # SSE chatbot endpoint
│   │   └── ws_inference.py  # WebSocket pose inference
│   ├── inference/
│   │   ├── runner.py        # async executor wrapper
│   │   └── smoother.py      # EMA keypoint smoother (P03)
│   ├── analysis/
│   │   ├── form_scorer.py   # ANGLE_RANGES + scoring
│   │   ├── score_smoother.py # EMA score smoother (P03)
│   │   ├── keypoint_utils.py
│   │   └── angle_ranges.json # Fit3D golden templates
│   ├── chatbot/             # RAG router, llm.py, rag.py, ingest.py
│   ├── middleware/          # security_headers, request_timing, cache (EXISTS)
│   └── monitoring/
│       └── metrics.py       # Prometheus metrics (EXISTS — do not recreate)
├── frontend/                # React PWA (Vite + TypeScript)
├── alembic/                 # Database migrations
├── scripts/                 # Eval scripts (eval_*.py), dataset tools
├── models/                  # Fine-tuned YOLO weights (.pt / .onnx)
├── data/                    # Datasets, eval results, thesis_tables/
├── tests/                   # Pytest backend tests (SQLite in-memory)
├── e2e/                     # Playwright E2E tests
├── nginx/                   # Production NGINX config
├── deploy/                  # docker-compose.prod.yml + Prometheus/Grafana configs
└── docs/                    # Prompt guide, thesis notes
```

## Thesis Metrics & Targets
| Metric | Target | Script |
|--------|--------|--------|
| YOLO mAP@0.5 | > 0.70 | eval_yolo.py |
| Inference latency p95 | < 100ms | eval_latency.py |
| Form score consistency | < 5% variance (20 identical inputs) | eval_form_consistency.py |
| Chatbot accuracy | ≥ 80% on 50 Q&A pairs | eval_chatbot.py |
| User study SUS | ≥ 70, n ≥ 10 participants | eval_user_study.py |
| Test coverage (app/analysis) | ≥ 80% | pytest --cov |

## Environment Variables
All from `.env` — never hardcode. See `.env.example` for the full list:
`POSTGRES_URL, REDIS_URL, GEMINI_API_KEY, GEMINI_MODEL, OPENROUTER_API_KEY,
JWT_SECRET, MODEL_PATH, CHROMA_PATH, ALLOWED_ORIGINS, ENVIRONMENT`

## Common Gotchas
- **`end2end=False` in any YOLO call → auto-BLOCK** — silently switches head, breaks keypoint parsing
- `results[0].keypoints.xyn` not `.xy` for normalized coordinates
- `/health/deep` must return **503** (not 200) if Postgres or Redis is down
- Tests use SQLite in-memory — NEVER real Postgres in test fixtures
- `asyncio_mode = "auto"` in pyproject.toml — no `@pytest.mark.asyncio` decorator needed
- Frontend: `playsInline` attribute on `<video>` element required for iOS Safari
- ChromaDB needs `persist_directory` or data is lost on restart
- `model.fuse()` must be called BEFORE `model.export()` for ONNX (removes auxiliary head)
- structlog throughout — never `print()` or `logging.getLogger()`
