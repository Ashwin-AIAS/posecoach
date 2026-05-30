---
name: p02-infrastructure
description: PoseCoach P02 — Docker, FastAPI, PostgreSQL, Redis, Alembic infrastructure setup. Auto-invoked when working on backend setup, database schema, migrations, Docker config, or project scaffolding.
allowed-tools: Read, Write, Edit, Bash
---

# P02 — Infrastructure (Docker + FastAPI + DB)

## Goal
Stand up the full backend infrastructure: FastAPI app, PostgreSQL DB, Redis cache, Alembic migrations, Docker Compose — all runnable with a single `docker-compose up --build`.

## Key Files
- `Dockerfile` — backend container
- `docker-compose.yml` — orchestration (api, db, redis)
- `app/main.py` — FastAPI app factory + lifespan (model loading here)
- `app/core/config.py` — settings via `pydantic-settings`
- `app/db/` — SQLAlchemy models + session
- `alembic/` — migration scripts
- `alembic.ini` — Alembic config
- `requirements.txt` — pinned dependencies
- `pyproject.toml` — ruff + mypy config

## FastAPI App Structure
```
app/
├── main.py          # app factory, lifespan, CORS
├── core/
│   ├── config.py    # Settings (pydantic-settings)
│   └── security.py  # JWT utilities
├── db/
│   ├── base.py      # SQLAlchemy base
│   ├── session.py   # async session factory
│   └── models/      # ORM models
├── api/
│   └── v1/          # routers
└── analysis/        # pose analysis (separate from API)
```

## Database Schema (Initial)
- `users` — id, email, hashed_password, created_at
- `sessions` — id, user_id, exercise_type, started_at, ended_at
- `pose_snapshots` — id, session_id, keypoints_json, score, timestamp

## Critical Rules
- YOLO26 model loaded in `lifespan` context manager on `app.state.model`
- Database URL from env: `DATABASE_URL`
- Redis URL from env: `REDIS_URL`
- Never hardcode connection strings

## Done Criteria
- [ ] `docker-compose up --build` succeeds with no errors
- [ ] FastAPI docs accessible at `http://localhost:8000/docs`
- [ ] `alembic upgrade head` applies all migrations cleanly
- [ ] Health check endpoint `GET /health` returns `{"status": "ok"}`
- [ ] `pytest tests/test_db.py` green (integration test against real DB)

## Thesis Metric
- Infrastructure reliability (uptime in deployment phase)
