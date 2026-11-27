---
name: p07-test-suite
description: PoseCoach P07 — Comprehensive test suite (Pytest, Vitest, Playwright). Auto-invoked when working on tests, test coverage, integration tests, E2E tests, or the quality gate.
---

# P07 — Test Suite

## Goal
Build a comprehensive test suite covering backend (pytest), frontend (vitest), and E2E (playwright). Achieve ≥80% coverage on `app/analysis`, the core thesis module.

## Testing Rules
- **Always use SQLite+aiosqlite in-memory** (`sqlite+aiosqlite:///:memory:`) for backend tests — NEVER real Postgres.
- **DO mock** external APIs (Gemini, OpenRouter, Kaggle) — use `respx` for httpx mocking
- **DO mock** YOLO model in non-inference tests — use a fixture that returns synthetic keypoints

## Coverage Target
- `app/analysis/` — ≥80% line coverage (enforced by `--cov-fail-under=80`)
- `app/api/` — ≥70% (nice to have)
- Frontend components — ≥60% (vitest)

## Run Commands
```bash
# Backend
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80

# Frontend
cd frontend && npx vitest run --coverage

# E2E
cd frontend && npx playwright test --headed
```

## Done Criteria
- [ ] `pytest` passes with ≥80% coverage on `app/analysis`
- [ ] `npx vitest run` passes
- [ ] Playwright E2E tests pass
