# PoseCoach — Multi-stage Docker build
# Stage 1: Build the React frontend (same-origin, no VITE_API_URL)
# Stage 2: Python 3.11 runtime with the built frontend baked in
# Build: docker build -t posecoach .
# Run:   docker-compose up backend

# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /frontend

# Install deps first (cached layer)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts

# Build the SPA — no VITE_API_URL means same-origin relative paths
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ─────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# System dependencies for OpenCV, psycopg, and build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (cached layer — only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=10 \
      torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --timeout=300 --retries=10 -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .
# scripts/ is needed at runtime: the startup hook imports scripts.seed_exercises
# to populate the exercise catalog on first boot (see lifespan).
COPY scripts/ ./scripts/

# Models and data directories
COPY models/ ./models/
COPY data/knowledge_base/ ./data/knowledge_base/
RUN mkdir -p data/chroma

# Built frontend from Stage 1 — served by the SPA static mount in app.main.
# When this dir is present the app serves the React shell at /; when absent
# (local dev, CI) the mount is cleanly skipped.
COPY --from=frontend-build /frontend/dist ./static

# NOTE: RAG ingest is NOT run at build time. It runs lazily at app startup
# (see lifespan -> _ensure_rag_index in app/main.py). The embedding model is
# downloaded at runtime regardless (query-time embedding), so baking the index
# at build added a fragile network dependency for no real benefit.

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Apply DB migrations before serving (matches docker-compose). The `alembic`
# console script needs the app importable, so PYTHONPATH must include /app.
# Assumes the database is reachable at container start (it is, per the deploy
# topology); a failed migration intentionally aborts startup rather than serving
# against a stale schema.
ENV PYTHONPATH=/app

# Production: no --reload flag
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
