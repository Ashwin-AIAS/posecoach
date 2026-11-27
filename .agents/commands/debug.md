# /debug

Structured debugging session for PoseCoach. Use when something is broken.

## Steps

1. **Reproduce** — Ask the user: "What exact error are you seeing? Paste the full traceback."
2. **Classify** — Identify the layer:
   - 🔴 YOLO/Inference → check `.agents/rules/yolo26.md` violations first
   - 🟡 FastAPI/WebSocket → check async/executor pattern
   - 🔵 Database/Alembic → check migration state
   - 🟢 Frontend/React → check TypeScript errors, WebSocket connection
   - ⚪ Docker/Infrastructure → check container logs
3. **Isolate** — Narrow down with targeted commands (`pytest tests/path/to/test.py -xvs`, `alembic current`).
4. **Hypothesize** — State the most likely cause in one sentence before fixing.
5. **Fix** — Make the minimal change. Don't refactor while debugging.
6. **Verify** — Re-run the failing test or reproduce step to confirm fix.
7. **Run quality gate** — `ruff + mypy + pytest` to ensure fix didn't break anything else.
