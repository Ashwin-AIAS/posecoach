"""Auth routes: register, login, logout, refresh, me, account delete.

Both tokens live in httpOnly cookies. The refresh cookie is scoped to
``/api/v1/auth/refresh`` so it never travels with other requests. On every
refresh the old token is revoked and a new pair is issued (rotation).
"""
# NOTE: deliberately NOT using `from __future__ import annotations`. slowapi wraps
# rate-limited endpoints with functools.wraps, and on older FastAPI/pydantic
# (as in the prod image) lazy string annotations like "RegisterRequest" fail to
# resolve through the wrapper. Real annotation objects sidestep that entirely.
from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    cookie_kwargs,
    get_current_user,
)
from app.auth.schemas import LoginRequest, RegisterRequest, UserResponse
from app.auth.security import (
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db import get_db
from app.models import RefreshToken, User
from app.rate_limit import AUTH_RATE_LIMIT, limiter

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

REFRESH_PATH = "/api/v1/auth/refresh"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=access_token,
        **cookie_kwargs(max_age=int(ACCESS_TOKEN_TTL.total_seconds())),
    )
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        **cookie_kwargs(max_age=int(REFRESH_TOKEN_TTL.total_seconds()), path=REFRESH_PATH),
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH)


async def _issue_token_pair(user_id: str, db: AsyncSession, response: Response) -> None:
    access_token = create_access_token(user_id)
    refresh_token, token_hash, expires_at = create_refresh_token(user_id)
    db.add(RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at))
    await db.flush()
    _set_auth_cookies(response, access_token, refresh_token)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(AUTH_RATE_LIMIT)
async def register(
    request: Request,
    payload: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    existing = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")

    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    db.add(user)
    await db.flush()
    await _issue_token_pair(user.id, db, response)
    logger.info("user_registered", user_id=user.id)
    return UserResponse(id=user.id, email=user.email, created_at=user.created_at)


@router.post("/login", response_model=UserResponse)
@limiter.limit(AUTH_RATE_LIMIT)
async def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    user = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password"
        )
    await _issue_token_pair(user.id, db, response)
    logger.info("user_login", user_id=user.id)
    return UserResponse(id=user.id, email=user.email, created_at=user.created_at)


@router.post("/refresh", response_model=UserResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="no refresh token")

    claims = decode_token(refresh_token, expected_type="refresh")
    if not claims:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid refresh token")

    user_id = claims.get("sub")
    token_hash = hash_token(refresh_token)
    stored = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    ).scalar_one_or_none()

    if not stored or stored.revoked or stored.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh token revoked"
        )
    # SQLite returns naive datetimes; treat them as UTC for the comparison
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh token expired")

    # Rotate: revoke the old token before issuing the new pair
    stored.revoked = True
    await db.flush()
    await _issue_token_pair(user_id, db, response)

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    logger.info("token_refreshed", user_id=user_id)
    return UserResponse(id=user.id, email=user.email, created_at=user.created_at)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if refresh_token:
        token_hash = hash_token(refresh_token)
        stored = (
            await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        ).scalar_one_or_none()
        if stored:
            stored.revoked = True
            await db.flush()
    _clear_auth_cookies(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=user.id, email=user.email, created_at=user.created_at)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """GDPR Article 17 — delete user + cascade workout sessions + refresh tokens."""
    await db.delete(user)
    await db.flush()
    _clear_auth_cookies(response)
    logger.info("account_deleted", user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
