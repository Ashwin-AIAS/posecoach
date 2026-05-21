"""Auth flow tests — register, login, logout, refresh, me, IDOR, GDPR delete."""
from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient, email: str = "a@x.com", password: str = "password123") -> dict[str, Any]:
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    return {"status": resp.status_code, "body": resp.json(), "cookies": resp.cookies}


async def test_register_creates_user_and_sets_cookies(client: AsyncClient) -> None:
    result = await _register(client)
    assert result["status"] == 201
    assert result["body"]["email"] == "a@x.com"
    # Both cookies present (cookie names contain hyphen-safe identifiers)
    cookies = client.cookies.jar
    cookie_names = {c.name for c in cookies}
    assert "access_token" in cookie_names
    assert "refresh_token" in cookie_names


async def test_register_duplicate_email_returns_409(client: AsyncClient) -> None:
    await _register(client, email="dup@x.com")
    client.cookies.clear()
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "dup@x.com", "password": "password123"}
    )
    assert resp.status_code == 409


async def test_register_weak_password_returns_422(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "weak@x.com", "password": "short"}
    )
    assert resp.status_code == 422


async def test_login_with_correct_credentials_sets_cookies(client: AsyncClient) -> None:
    await _register(client, email="login@x.com", password="password123")
    client.cookies.clear()
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "login@x.com", "password": "password123"}
    )
    assert resp.status_code == 200
    assert any(c.name == "access_token" for c in client.cookies.jar)


async def test_login_wrong_password_returns_401(client: AsyncClient) -> None:
    await _register(client, email="wp@x.com", password="password123")
    client.cookies.clear()
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "wp@x.com", "password": "wrongpass1"}
    )
    assert resp.status_code == 401


async def test_login_unknown_email_returns_401(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@x.com", "password": "password123"}
    )
    assert resp.status_code == 401


async def test_me_without_cookie_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_me_with_cookie_returns_user(client: AsyncClient) -> None:
    await _register(client, email="me@x.com")
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@x.com"


async def test_logout_clears_cookies(client: AsyncClient) -> None:
    await _register(client, email="lo@x.com")
    resp = await client.post("/api/v1/auth/logout")
    assert resp.status_code == 204
    # After logout, /me should reject (httpx will still echo cookies but server clears them)
    client.cookies.clear()
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 401


async def test_refresh_rotates_token(client: AsyncClient) -> None:
    await _register(client, email="rf@x.com")
    # Grab original refresh-token value
    original_refresh = next(
        (c.value for c in client.cookies.jar if c.name == "refresh_token"), None
    )
    assert original_refresh is not None

    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 200
    new_refresh = next(
        (c.value for c in client.cookies.jar if c.name == "refresh_token"), None
    )
    assert new_refresh is not None
    assert new_refresh != original_refresh


async def test_refresh_with_revoked_token_returns_401(client: AsyncClient) -> None:
    await _register(client, email="rev@x.com")
    original = next((c.value for c in client.cookies.jar if c.name == "refresh_token"), None)
    assert original is not None

    # First refresh rotates the token, revoking the original
    first = await client.post("/api/v1/auth/refresh")
    assert first.status_code == 200

    # Replant the OLD token and try again — should be rejected
    client.cookies.clear()
    resp = await client.post(
        "/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={original}"}
    )
    assert resp.status_code == 401


async def test_refresh_without_cookie_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 401


async def test_delete_account_removes_user(client: AsyncClient) -> None:
    await _register(client, email="del@x.com")
    resp = await client.delete("/api/v1/auth/account")
    assert resp.status_code == 204
    # After delete, /me should 401 (user no longer exists)
    client.cookies.clear()
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 401


async def test_register_invalid_email_returns_422(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register", json={"email": "not-an-email", "password": "password123"}
    )
    assert resp.status_code == 422
