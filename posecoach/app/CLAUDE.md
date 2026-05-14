# app/ — FastAPI Backend

## What This Directory Is
The entire Python backend. Every file here runs server-side — never in the browser.

## Module Map
```
app/
├── main.py              # FastAPI app instance, lifespan, CORS, middleware registration
├── db.py                # Async SQLAlchemy engine, session factory, Base, get_db dependency
├── models.py            # ORM models: User, WorkoutSession (no raw SQL ever)
├── cache.py             # Redis async client, create_redis_client()
├── logging_config.py    # structlog JSON setup — call setup_logging() in lifespan
├── metrics.py           # Prometheus counters/histograms — import and use in handlers
│
├── auth/                # JWT httpOnly cookies, register/login/logout/delete
├── history/             # WorkoutSession CRUD — always filter by user_id
├── inference/           # WebSocket endpoint, YOLO predictor, keypoint smoother
├── analysis/            # angle_calculator, form_scorer, rep_counter, score_smoother
├── chatbot/             # RAG router (SSE), rag.py, llm.py, knowledge/, ingest.py
└── middleware/          # request_id, timing, security_headers
```

## Non-Negotiable Rules
- Every function has type hints — args AND return type
- Every DB/Redis operation is async — no sync calls
- No `print()` — only `structlog.get_logger(__name__).info/error/warning`
- No raw SQL — only SQLAlchemy async ORM
- No secrets hardcoded — only `os.environ["KEY"]`
- All secrets fail loudly on startup if missing (KeyError is intentional)

## Import Pattern
```python
# Standard lib first, then third-party, then local app imports
import os
from datetime import datetime
import structlog
from fastapi import FastAPI, Depends
from app.db import get_db
from app.models import User
```

## Logging Pattern (Use Everywhere)
```python
import structlog
logger = structlog.get_logger(__name__)

# Good
logger.info("inference_complete", exercise="squat", score=85, latency_ms=42)
logger.error("db_query_failed", error=str(e), user_id=user.id)

# Never log these: password, hashed_password, access_token, frame, frame_bytes
```

## What Does NOT Go Here
- Frontend code (HTML, CSS, JS, TypeScript) → `frontend/`
- Eval/dataset scripts → `scripts/`
- Test files → `tests/`
- Alembic migrations → `alembic/`
