---
name: p07-test-suite
description: PoseCoach P07 — Comprehensive test suite (Pytest, Vitest, Playwright). Auto-invoked when working on tests, test coverage, integration tests, E2E tests, or the quality gate.
allowed-tools: Read, Write, Edit, Bash
---

# P07 — Test Suite

## Goal
Build a comprehensive test suite covering backend (pytest), frontend (vitest), and E2E (playwright). Achieve ≥80% coverage on `app/analysis`, the core thesis module.

## Key Directories
- `tests/` — pytest tests (backend)
- `tests/test_inference.py` — pose inference tests
- `tests/test_form_scorer.py` — form scoring unit tests
- `tests/test_auth.py` — auth integration tests
- `tests/test_history.py` — history API tests
- `tests/test_chatbot.py` — RAG + routing tests
- `frontend/src/__tests__/` — vitest unit tests
- `e2e/` — Playwright E2E tests

## Testing Rules
- **NEVER mock the database** — integration tests use a real test DB (separate from dev)
- **DO mock** external APIs (Gemini, OpenRouter, Kaggle) — use `respx` for httpx mocking
- **DO mock** YOLO model in non-inference tests — use a fixture that returns synthetic keypoints
- Test DB: set `DATABASE_URL` to a test-specific Postgres DB in `conftest.py`

## Pytest Setup (conftest.py)
```python
@pytest.fixture(scope="session")
async def db():
    # real test DB, migrations applied
    ...

@pytest.fixture
def mock_yolo():
    # returns synthetic 17-keypoint result
    ...
```

## Coverage Target
- `app/analysis/` — ≥80% line coverage (enforced by `--cov-fail-under=80`)
- `app/api/` — ≥70% (nice to have)
- Frontend components — ≥60% (vitest)

## E2E Tests (Playwright)
- `e2e/test_login.py` — register + login flow
- `e2e/test_camera.py` — camera permission + WebSocket connect
- `e2e/test_history.py` — session appears in history after workout

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
- [ ] At least 2 Playwright E2E tests pass
- [ ] No database mocking in any test

## Thesis Metric
- Test coverage % on core analysis module
- Number of passing tests (reliability indicator)
