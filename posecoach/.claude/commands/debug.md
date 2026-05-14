# /debug

Structured debugging session for PoseCoach. Use when something is broken.

## Steps

1. **Reproduce** — Ask the user: "What exact error are you seeing? Paste the full traceback."
2. **Classify** — Identify the layer:
   - 🔴 YOLO/Inference → check `rules/yolo26.md` violations first
   - 🟡 FastAPI/WebSocket → check async/executor pattern
   - 🔵 Database/Alembic → check migration state
   - 🟢 Frontend/React → check TypeScript errors, WebSocket connection
   - ⚪ Docker/Infrastructure → check container logs

3. **Isolate** — Narrow down with targeted commands:
   ```bash
   # Backend logs
   docker-compose logs api --tail=50
   # Run specific failing test
   pytest tests/path/to/test.py -xvs
   # Check DB state
   alembic current
   ```

4. **Hypothesize** — State the most likely cause in one sentence before fixing.
5. **Fix** — Make the minimal change. Don't refactor while debugging.
6. **Verify** — Re-run the failing test or reproduce step to confirm fix.
7. **Run quality gate** — `ruff + mypy + pytest` to ensure fix didn't break anything else.

## Common PoseCoach Gotchas
- `RuntimeError: no running event loop` → inference called on async loop, not in executor
- `AttributeError: 'NoneType' object has no attribute 'xyn'` → model not loaded in lifespan
- `alembic.util.exc.CommandError: Target database is not up to date` → run `alembic upgrade head`
- `422 Unprocessable Entity` on FastAPI → Pydantic validation error, check request schema
- WebSocket immediately closes → check CORS settings in `app/main.py`
