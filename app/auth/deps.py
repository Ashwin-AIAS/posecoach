"""FastAPI dependencies for resolving the current user from cookies."""
from __future__ import annotations

import os
from typing import Literal, TypedDict, cast

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_token
from app.db import get_db
from app.models import User

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
COOKIE_SECURE = os.environ.get("ENVIRONMENT", "development") != "development"


def _resolve_samesite() -> Literal["lax", "strict", "none"]:
    """Read COOKIE_SAMESITE (default "lax"); "none" needs a secure context.

    A Vercel frontend calling a separate HF Space backend is cross-origin, so
    the auth cookies need SameSite=None to flow at all — but SameSite=None
    without Secure is rejected outright by browsers, so a misconfigured prod
    deploy should fail loudly at startup rather than silently drop cookies.
    """
    raw = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    if raw not in ("lax", "strict", "none"):
        raise ValueError(f'COOKIE_SAMESITE must be "lax", "strict", or "none" — got {raw!r}')
    if raw == "none" and not COOKIE_SECURE:
        raise ValueError("COOKIE_SAMESITE=none requires a secure (non-development) ENVIRONMENT")
    return cast(Literal["lax", "strict", "none"], raw)


COOKIE_SAMESITE = _resolve_samesite()


class CookieKwargs(TypedDict):
    """Typed kwargs for Response.set_cookie — matches starlette's signature."""

    httponly: bool
    secure: bool
    samesite: Literal["lax", "strict", "none"]
    max_age: int
    path: str


def cookie_kwargs(max_age: int, path: str = "/") -> CookieKwargs:
    """Standard secure-cookie kwargs for set_cookie."""
    return {
        "httponly": True,
        "secure": COOKIE_SECURE,
        "samesite": COOKIE_SAMESITE,
        "max_age": max_age,
        "path": path,
    }


async def get_current_user(
    access_token: str | None = Cookie(default=None, alias=ACCESS_COOKIE),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the authenticated user from the access-token cookie.

    Raises 401 if the cookie is missing, expired, or invalid.
    """
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")

    claims = decode_token(access_token, expected_type="access")
    if not claims:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user


async def get_user_from_cookie_optional(
    access_token: str | None, db: AsyncSession
) -> User | None:
    """Resolve a user from a raw cookie value or return None — used by the WS handler."""
    if not access_token:
        return None
    claims = decode_token(access_token, expected_type="access")
    if not claims:
        return None
    user_id = claims.get("sub")
    if not user_id:
        return None
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
