"""Account-recovery endpoint tests (P33).

Enumeration-safety, token minting, single-use + expiry, bad-token rejection,
rate-limit trip, and mailer invocation. SMTP is never touched — the mailer
functions are monkeypatched to capture the reset URL.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import auth_recovery
from app.auth.security import hash_token, verify_password
from app.models import PasswordResetToken, User
from app.rate_limit import limiter


@pytest.fixture
def captured_mail(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Capture reset URL / username instead of sending real mail."""
    box: dict[str, Any] = {}

    async def fake_reset(email: str, url: str) -> None:
        box["reset_email"] = email
        box["reset_url"] = url

    async def fake_username(email: str, username: str) -> None:
        box["username_email"] = email
        box["username"] = username

    monkeypatch.setattr(auth_recovery, "send_password_reset", fake_reset)
    monkeypatch.setattr(auth_recovery, "send_username", fake_username)
    return box


async def _register(client: AsyncClient, email: str, password: str = "password123") -> str:
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 201
    client.cookies.clear()
    return str(resp.json()["id"])


def _token_from_url(url: str) -> str:
    return url.split("token=", 1)[1]


# ── Enumeration safety ────────────────────────────────────────────────────────


async def test_forgot_password_identical_for_registered_and_unknown(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "known@x.com")

    known = await client.post("/api/v1/auth/forgot-password", json={"email": "known@x.com"})
    unknown = await client.post("/api/v1/auth/forgot-password", json={"email": "nobody@x.com"})

    assert known.status_code == 200
    assert unknown.status_code == 200
    assert known.json() == unknown.json()


async def test_forgot_username_identical_for_registered_and_unknown(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "known2@x.com")

    known = await client.post("/api/v1/auth/forgot-username", json={"email": "known2@x.com"})
    unknown = await client.post("/api/v1/auth/forgot-username", json={"email": "nobody2@x.com"})

    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


# ── Token minting ─────────────────────────────────────────────────────────────


async def test_token_created_for_real_user_none_for_unknown(
    client: AsyncClient, test_db: AsyncSession, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "mint@x.com")

    await client.post("/api/v1/auth/forgot-password", json={"email": "mint@x.com"})
    await client.post("/api/v1/auth/forgot-password", json={"email": "ghost@x.com"})

    rows = (await test_db.execute(select(PasswordResetToken))).scalars().all()
    assert len(rows) == 1  # exactly one, for the real user
    assert captured_mail["reset_email"] == "mint@x.com"
    assert "/reset-password?token=" in captured_mail["reset_url"]


# ── Reset happy path + single use ─────────────────────────────────────────────


async def test_valid_token_changes_password_and_marks_used(
    client: AsyncClient, test_db: AsyncSession, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "reset@x.com", "oldpassword1")
    await client.post("/api/v1/auth/forgot-password", json={"email": "reset@x.com"})
    token = _token_from_url(captured_mail["reset_url"])

    resp = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "newpassword2"}
    )
    assert resp.status_code == 200

    # used_at is stamped and the stored password now matches the new one.
    row = (await test_db.execute(select(PasswordResetToken))).scalar_one()
    assert row.used_at is not None
    user = (
        await test_db.execute(select(User).where(User.email == "reset@x.com"))
    ).scalar_one()
    assert verify_password("newpassword2", user.hashed_password)
    assert not verify_password("oldpassword1", user.hashed_password)


async def test_login_works_with_new_password_after_reset(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "flow@x.com", "oldpassword1")
    await client.post("/api/v1/auth/forgot-password", json={"email": "flow@x.com"})
    token = _token_from_url(captured_mail["reset_url"])
    await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "brandnew3"}
    )
    client.cookies.clear()

    ok = await client.post("/api/v1/auth/login", json={"email": "flow@x.com", "password": "brandnew3"})
    assert ok.status_code == 200
    client.cookies.clear()
    bad = await client.post(
        "/api/v1/auth/login", json={"email": "flow@x.com", "password": "oldpassword1"}
    )
    assert bad.status_code == 401


async def test_used_token_is_rejected(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "reuse@x.com")
    await client.post("/api/v1/auth/forgot-password", json={"email": "reuse@x.com"})
    token = _token_from_url(captured_mail["reset_url"])

    first = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "firstpass1"}
    )
    assert first.status_code == 200
    second = await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "secondpass2"}
    )
    assert second.status_code == 400


# ── Bad tokens ────────────────────────────────────────────────────────────────


async def test_expired_token_is_rejected(client: AsyncClient, test_db: AsyncSession) -> None:
    user_id = await _register(client, "expired@x.com")
    raw = "expired-raw-token-abcdef"
    test_db.add(
        PasswordResetToken(
            user_id=user_id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
    )
    await test_db.flush()

    resp = await client.post(
        "/api/v1/auth/reset-password", json={"token": raw, "new_password": "whatever12"}
    )
    assert resp.status_code == 400


async def test_garbage_token_is_rejected(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": "not-a-real-token", "new_password": "whatever12"},
    )
    assert resp.status_code == 400


async def test_reset_password_enforces_min_length(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/reset-password", json={"token": "anything", "new_password": "short"}
    )
    assert resp.status_code == 422


# ── Mailer invocation ─────────────────────────────────────────────────────────


async def test_forgot_username_mails_the_username(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    await _register(client, "uname@x.com")
    await client.post("/api/v1/auth/forgot-username", json={"email": "uname@x.com"})
    assert captured_mail["username"] == "uname@x.com"
    assert captured_mail["username_email"] == "uname@x.com"


# ── Rate limiting ─────────────────────────────────────────────────────────────


async def test_forgot_password_rate_limit_trips(
    client: AsyncClient, captured_mail: dict[str, Any]
) -> None:
    """3/hour per email: the 4th request from the same email trips a 429."""
    await _register(client, "rl@x.com")
    limiter.enabled = True
    try:
        statuses = []
        for _ in range(4):
            resp = await client.post("/api/v1/auth/forgot-password", json={"email": "rl@x.com"})
            statuses.append(resp.status_code)
    finally:
        limiter.enabled = False
        limiter.reset()

    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429
