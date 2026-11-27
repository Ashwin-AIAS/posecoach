"""P36 C7 — Coach AI server-side session memory tests (SQLite in-memory)."""
from __future__ import annotations

from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import ACCESS_COOKIE
from app.auth.security import create_access_token, hash_password
from app.models import User, WorkoutSession


@pytest.mark.asyncio
async def test_signed_in_chat_injects_last_5_sessions_and_skips_cache(
    client: AsyncClient,
    test_db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import chat as chat_module
    from app.main import app

    user = User(email="lifter@example.com", hashed_password=hash_password("StrongPass1!"))
    test_db.add(user)
    await test_db.flush()

    now = datetime.now(UTC)
    # Seed 6 sessions — only the 5 most recent should appear in the summary.
    for i in range(6):
        test_db.add(
            WorkoutSession(
                user_id=user.id,
                exercise="squat" if i % 2 == 0 else "deadlift",
                rep_count=6 + i,
                avg_form_score=70.0 + i * 3,
                started_at=now - timedelta(days=i),
            )
        )
    await test_db.commit()

    captured_system: list[str | None] = []
    cache_load_called = False

    async def _capture_gemini(
        prompt: str,
        executor: object,
        history: object = None,
        system_prompt_override: str | None = None,
    ) -> AsyncIterator[str]:
        captured_system.append(system_prompt_override)
        yield "Great work."

    async def _spy_cache_load(*args: object, **kwargs: object) -> None:
        nonlocal cache_load_called
        cache_load_called = True
        return None

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _capture_gemini)
    monkeypatch.setattr(chat_module.rag, "retrieve_scored_async", _empty_rag)
    monkeypatch.setattr(chat_module.answer_cache, "load", _spy_cache_load)
    if not hasattr(app.state, "executor"):
        app.state.executor = ThreadPoolExecutor(max_workers=1)

    token = create_access_token(user.id)
    resp = await client.post(
        "/api/v1/chat/stream",
        json={"query": "How should I progress my squat?", "exercise": "squat"},
        cookies={ACCESS_COOKIE: token},
    )

    assert resp.status_code == 200
    assert len(captured_system) == 1
    sys_prompt = captured_system[0]
    assert sys_prompt is not None
    assert "User recent workout context" in sys_prompt
    assert "squat" in sys_prompt
    assert "deadlift" in sys_prompt
    # Summary section itself must be <= 400 chars.
    summary_section = sys_prompt.split("## User recent workout context\n", 1)[1]
    assert len(summary_section) <= 400
    # Personalized turn must skip shared answer cache.
    assert cache_load_called is False


@pytest.mark.asyncio
async def test_anonymous_chat_has_no_session_memory_and_ignores_client_context(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import chat as chat_module
    from app.main import app

    captured_system: list[str | None] = []

    async def _capture_gemini(
        prompt: str,
        executor: object,
        history: object = None,
        system_prompt_override: str | None = None,
    ) -> AsyncIterator[str]:
        captured_system.append(system_prompt_override)
        yield "Keep your chest tall."

    monkeypatch.setattr(chat_module.gemini_client, "stream_chat", _capture_gemini)
    monkeypatch.setattr(chat_module.rag, "retrieve_scored_async", _empty_rag)
    if not hasattr(app.state, "executor"):
        app.state.executor = ThreadPoolExecutor(max_workers=1)

    resp = await client.post(
        "/api/v1/chat/stream",
        json={
            "query": "How deep should I squat?",
            "exercise": "squat",
            # Attempted client-injected context must be ignored.
            "session_summary": "INJECTED_FAKE_HISTORY",
        },
    )

    assert resp.status_code == 200
    assert len(captured_system) == 1
    assert captured_system[0] is None


async def _empty_rag(query: str, executor: object, top_k: int = 3) -> list[object]:
    return []
