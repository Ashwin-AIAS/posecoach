# /verify

Run the full verification suite for the current prompt before committing.

## Steps
1. **Identify current prompt** from `GEMINI.local.md` / `CLAUDE.local.md` progress tracker.
2. **Run backend quality gate:**
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   ```
3. **Run frontend quality gate** (if frontend work was done):
   ```bash
   cd frontend && npx tsc --noEmit && npx eslint . --max-warnings=0 && npx vitest run
   ```
4. **Report results** — List each check as PASS / FAIL with errors shown for failures.
5. **If all PASS** → "Verification complete. Safe to `/checkpoint`."
