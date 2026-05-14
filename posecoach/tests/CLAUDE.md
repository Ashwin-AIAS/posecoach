# tests/ — Backend Pytest Test Suite

## What This Directory Is
All backend Python tests. Uses pytest with async fixtures and SQLite in-memory DB.
Coverage gate: 80% on `app/analysis/`, 70% on `app/auth/`.

## Test File Map
```
tests/
├── conftest.py                   # Shared fixtures: test_db, client, async engine
├── test_auth.py                  # Register, login, logout, delete account, IDOR
├── test_history.py               # Session start/end, history listing, ownership
├── test_angle_calculator.py      # Known-angle parametrized tests for all 7 exercises
├── test_form_scorer.py           # All 7 exercises return valid FormResult
├── test_form_consistency.py      # 20 identical inputs → < 5% variance (thesis metric)
├── test_keypoint_confidence.py   # Low-conf keypoints are skipped, not used
├── test_plank_scorer.py          # Plank returns hold_duration, not reps
├── test_score_smoother.py        # EMA converges, reset works
├── test_rep_counter.py           # Peak detection with synthetic score curves
├── test_ws_handler.py            # WebSocket accepts, returns score+cues
└── test_health.py                # /health/deep returns 503 when deps down
```

## conftest.py Pattern (Always Use This)
```python
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.db import Base, get_db

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

@pytest_asyncio.fixture(scope="function")
async def test_db():
    engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()

@pytest_asyncio.fixture(scope="function")
async def client(test_db):
    app.dependency_overrides[get_db] = lambda: test_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

## Rules
- `asyncio_mode = "auto"` is set in pyproject.toml — NO `@pytest.mark.asyncio` decorator needed
- NEVER use real Postgres — always SQLite+aiosqlite in-memory
- ALWAYS clear `app.dependency_overrides` after each test (done in fixture teardown)
- For WebSocket tests, use `starlette.testclient.TestClient` (httpx doesn't support WS)
- Test names: `test_[what]_[condition]_[expected]` e.g. `test_login_wrong_password_returns_401`

## Run Commands
```bash
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
pytest tests/test_form_scorer.py -v -s    # Single file with verbose output
pytest --cov=app --cov-report=term-missing  # Full coverage report
```

## What Does NOT Go Here
- E2E tests → `e2e/`
- Frontend tests → `frontend/src/__tests__/`
- Eval scripts → `scripts/`
