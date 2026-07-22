"""Account-recovery routes (P33): forgot-password, forgot-username, reset.

Additive router — mounted alongside the existing auth router, never editing its
behavior. Security design:

- **Enumeration-safe:** ``forgot-*`` always return an identical generic ``200``
  whether or not the email is registered, so the form can't be used to discover
  accounts. Work (mint token / send mail) only happens for real users.
- **Token security:** ``secrets.token_urlsafe(32)`` raw token mailed to the
  user; only its SHA-256 hash is stored. Single-use (``used_at`` stamped on
  success) and time-boxed (``RESET_TOKEN_TTL_MIN``, default 20). A leaked DB row
  is useless — the raw token can't be derived from the hash.
- **No session invalidation** on reset (descoped) — short-lived access tokens
  are the compensating control.
- Never logs the raw token, password, or full email — ``user_id`` + event only.

NOTE: deliberately NOT using ``from __future__ import annotations`` — slowapi
wraps the decorated handler and breaks under stringified annotations (see the
same note in ``auth.py`` / ``nutrition.py``).
"""

import json
import os
import secrets
import smtplib
from datetime import UTC, datetime, timedelta

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import ForgotRequest, GenericMessageResponse, ResetPasswordRequest
from app.auth.security import hash_password, hash_token
from app.db import get_db
from app.mail import send_password_reset, send_username
from app.models import PasswordResetToken, User
from app.rate_limit import RECOVERY_RATE_LIMIT, limiter

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth-recovery"])

DEFAULT_RESET_TOKEN_TTL_MIN = 20
DEFAULT_FRONTEND_BASE_URL = "http://localhost:5173"
# Identical bodies regardless of account existence — the anti-enumeration guard.
FORGOT_PASSWORD_MESSAGE = "If that email is registered, we've sent a reset link."
FORGOT_USERNAME_MESSAGE = "If that email is registered, we've sent the username."
RESET_OK_MESSAGE = "Your password has been updated. You can now sign in."
RESET_BAD_TOKEN_MESSAGE = "This reset link is invalid or has expired."


def _token_ttl() -> timedelta:
    try:
        minutes = int(os.environ.get("RESET_TOKEN_TTL_MIN", DEFAULT_RESET_TOKEN_TTL_MIN))
    except ValueError:
        minutes = DEFAULT_RESET_TOKEN_TTL_MIN
    return timedelta(minutes=max(1, minutes))


def _reset_url(raw_token: str) -> str:
    base = os.environ.get("FRONTEND_BASE_URL", DEFAULT_FRONTEND_BASE_URL).rstrip("/")
    return f"{base}/reset-password?token={raw_token}"


def _email_rate_key(request: Request) -> str:
    """Rate-limit key derived from the submitted email (P33 per-email guard).

    FastAPI has already parsed — and therefore buffered — the JSON body by the
    time slowapi evaluates this synchronous key function, so the cached bytes
    are readable here. Falls back to the client IP if the body is unreadable so
    the limit never silently disables itself.
    """
    raw = getattr(request, "_body", b"")
    email = ""
    if raw:
        try:
            payload = json.loads(raw)
            email = str(payload.get("email", "")).strip().lower()
        except (ValueError, TypeError, AttributeError):
            email = ""
    return f"pwreset:email:{email}" if email else f"pwreset:ip:{get_remote_address(request)}"


async def _find_user(email: str, db: AsyncSession) -> User | None:
    return (
        await db.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


@router.post("/forgot-password", response_model=GenericMessageResponse)
@limiter.limit(RECOVERY_RATE_LIMIT)
@limiter.limit(RECOVERY_RATE_LIMIT, key_func=_email_rate_key)
async def forgot_password(
    request: Request,
    payload: ForgotRequest,
    db: AsyncSession = Depends(get_db),
) -> GenericMessageResponse:
    """Mint + mail a reset link if the account exists. Always generic 200."""
    user = await _find_user(payload.email, db)
    if user is not None:
        raw_token = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(raw_token),
                expires_at=datetime.now(UTC) + _token_ttl(),
            )
        )
        await db.flush()
        try:
            await send_password_reset(user.email, _reset_url(raw_token))
        except (smtplib.SMTPException, OSError, ValueError, KeyError) as exc:
            # Best-effort mail — the token row stands and will expire unused.
            logger.warning("password_reset_mail_failed", user_id=user.id, error=str(exc))
        logger.info("password_reset_requested", user_id=user.id)
    return GenericMessageResponse(message=FORGOT_PASSWORD_MESSAGE)


@router.post("/forgot-username", response_model=GenericMessageResponse)
@limiter.limit(RECOVERY_RATE_LIMIT)
@limiter.limit(RECOVERY_RATE_LIMIT, key_func=_email_rate_key)
async def forgot_username(
    request: Request,
    payload: ForgotRequest,
    db: AsyncSession = Depends(get_db),
) -> GenericMessageResponse:
    """Mail the username (= sign-in email) if the account exists. Generic 200."""
    user = await _find_user(payload.email, db)
    if user is not None:
        try:
            await send_username(user.email, user.email)
        except (smtplib.SMTPException, OSError, ValueError, KeyError) as exc:
            logger.warning("username_reminder_mail_failed", user_id=user.id, error=str(exc))
        logger.info("username_reminder_requested", user_id=user.id)
    return GenericMessageResponse(message=FORGOT_USERNAME_MESSAGE)


@router.post("/reset-password", response_model=GenericMessageResponse)
@limiter.limit(RECOVERY_RATE_LIMIT)
async def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
) -> GenericMessageResponse:
    """Consume a valid, unexpired, unused token and set the new password."""
    bad_token = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail=RESET_BAD_TOKEN_MESSAGE
    )
    token_hash = hash_token(payload.token)
    stored = (
        await db.execute(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
        )
    ).scalar_one_or_none()

    if stored is None or stored.used_at is not None:
        raise bad_token

    # SQLite returns naive datetimes; treat them as UTC for the comparison.
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise bad_token

    user = (
        await db.execute(select(User).where(User.id == stored.user_id))
    ).scalar_one_or_none()
    if user is None:
        raise bad_token

    user.hashed_password = hash_password(payload.new_password)
    stored.used_at = datetime.now(UTC)
    await db.flush()
    logger.info("password_reset_completed", user_id=user.id)
    return GenericMessageResponse(message=RESET_OK_MESSAGE)
