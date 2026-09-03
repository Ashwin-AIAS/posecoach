#!/bin/sh
# PoseCoach container entrypoint — boot-resilience sequencing.
#
# Runs before Python's structlog setup exists, so plain `echo` is used here
# instead of structured logging; that is deliberate, not an oversight.
#
# Sequence: wait for the DB (Neon scale-to-zero means the first connection
# after any idle period is a guaranteed cold start) -> run migrations exactly
# once -> exec uvicorn so it becomes PID 1 and receives signals directly.
#
# Alembic is NOT retried: if wait_for_db succeeded but the migration itself
# fails, that is a real schema/migration fault, not a transient DB hiccup —
# it must surface immediately rather than be masked by another retry loop.
set -euo pipefail

echo "docker-entrypoint: waiting for database..."
if ! python scripts/wait_for_db.py; then
    echo "docker-entrypoint: database did not become reachable in time — aborting boot" >&2
    exit 1
fi

echo "docker-entrypoint: database reachable, running migrations..."
alembic upgrade head

echo "docker-entrypoint: migrations applied, starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
