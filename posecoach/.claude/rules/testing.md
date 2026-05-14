# Testing Rules

## Test Database — SQLite In-Memory (NOT Postgres)
**Always use SQLite+aiosqlite in-memory for backend tests — NEVER a real Postgres DB.**
```python
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
```
Why: In-memory SQLite is fast, isolated, requires no external service, and is automatically destroyed after each test function. Real Postgres adds CI complexity with no meaningful benefit for unit/integration tests.

## Standard conftest.py Pattern (Always Use This Exactly)
```python
import pytest, pytest_asyncio
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
    app.dependency_overrides.clear()  # ← ALWAYS clear after test
```

## Async Test Setup
- `asyncio_mode = "auto"` is set in `pyproject.toml` — **NO `@pytest.mark.asyncio` decorator needed**
- Use `@pytest_asyncio.fixture` for async fixtures, not `@pytest.fixture`
- For WebSocket tests: use `starlette.testclient.TestClient` (httpx doesn't support WS)

## What TO Mock
- External APIs: Gemini, OpenRouter/Qwen — use `respx` for httpx mocking
- YOLO model in non-inference tests — synthetic 17-keypoint fixture
- Redis — use `fakeredis.aioredis` (in-memory, no real Redis needed)
- Time — use `freezegun` for timestamp tests

## Expected Test Files
```
tests/
├── conftest.py
├── test_health.py              # /health/deep returns 503 when deps down
├── test_auth.py                # register, login, logout, delete, IDOR checks
├── test_history.py             # session CRUD, ownership checks
├── test_angle_calculator.py    # parametrized known-angle tests, all 7 exercises
├── test_form_scorer.py         # all 7 exercises return valid FormResult
├── test_form_consistency.py    # 20 identical inputs → < 5% score variance
├── test_keypoint_confidence.py # low-conf keypoints skipped
├── test_plank_scorer.py        # plank returns hold_duration not reps
├── test_score_smoother.py      # EMA converges, reset works
├── test_rep_counter.py         # peak detection with synthetic curves
└── test_ws_handler.py          # WebSocket accepts frame, returns score+cues
```

## Coverage Requirements
| Module | Target | Enforced |
|--------|--------|---------|
| `app/analysis/` | ≥ 80% | `--cov-fail-under=80` |
| `app/auth/` | ≥ 70% | Not enforced, target |

## Run Commands
```bash
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
pytest tests/test_form_scorer.py -v -s    # single file, verbose
pytest --cov=app --cov-report=term-missing  # full coverage map
```
