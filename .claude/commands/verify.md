# /verify

Run the full verification suite for the current prompt before committing.

## Steps

1. **Identify current prompt** from `CLAUDE.local.md` progress tracker.
2. **Run quality gate:**
   ```bash
   ruff check app/ --fix && echo "ruff: PASS"
   mypy app/ --strict && echo "mypy: PASS"
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80 && echo "pytest: PASS"
   ```
3. **Run frontend tests** (if P04+ work was done):
   ```bash
   cd frontend && npx vitest run && echo "vitest: PASS"
   ```
4. **Check Docker build** (if infrastructure files changed):
   ```bash
   docker-compose build --no-cache 2>&1 | tail -5
   ```
5. **Report results** — List each check as PASS / FAIL with errors shown for failures.
6. **If all PASS** → "Verification complete. Safe to `/checkpoint`."
7. **If any FAIL** → List issues. Do NOT proceed to checkpoint until fixed.
