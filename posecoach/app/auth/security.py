"""Password hashing + JWT creation/verification utilities.

JWT scheme: HS256, secret from ``JWT_SECRET`` env var.
- Access token: 15 min expiry, ``type=access`` claim
- Refresh token: 30 day expiry, ``type=refresh`` claim, hash stored in DB for rotation
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import structlog
from jose import JWTError, jwt

logger = structlog.get_logger(__name__)

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)

# bcrypt 4.x enforces a 72-byte password limit. We pre-hash with SHA-256 so any
# UTF-8 password length is accepted — standard mitigation.
def _prepare(plain: str) -> bytes:
    return hashlib.sha256(plain.encode("utf-8")).digest()


def _get_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret or len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be set and at least 32 characters")
    return secret


def hash_password(plain: str) -> str:
    """Bcrypt-hash a password. Never store plain text."""
    return bcrypt.hashpw(_prepare(plain), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if ``plain`` matches the bcrypt hash."""
    try:
        return bcrypt.checkpw(_prepare(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def _encode(payload: dict[str, Any], ttl: timedelta, token_type: str) -> str:
    now = datetime.now(UTC)
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "type": token_type,
    }
    return jwt.encode(body, _get_secret(), algorithm=ALGORITHM)


def create_access_token(user_id: str) -> str:
    """Issue a short-lived access JWT."""
    return _encode({"sub": user_id}, ACCESS_TOKEN_TTL, "access")


def create_refresh_token(user_id: str) -> tuple[str, str, datetime]:
    """Issue a refresh JWT.

    Returns ``(token, token_hash, expires_at)``. Only the hash is persisted —
    the raw token lives in the httpOnly cookie. A 16-byte ``jti`` (JWT ID)
    is embedded so two refresh tokens issued in the same second hash differently.
    """
    jti = secrets.token_urlsafe(16)
    token = _encode({"sub": user_id, "jti": jti}, REFRESH_TOKEN_TTL, "refresh")
    expires_at = datetime.now(UTC) + REFRESH_TOKEN_TTL
    return token, hash_token(token), expires_at


def hash_token(token: str) -> str:
    """SHA-256 of the token — deterministic, used for DB lookup."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def decode_token(token: str, expected_type: str) -> dict[str, Any] | None:
    """Decode + validate a JWT. Returns claims dict or None on any failure."""
    try:
        claims = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
    except JWTError as exc:
        logger.info("jwt_decode_failed", error=str(exc))
        return None
    if claims.get("type") != expected_type:
        logger.info("jwt_wrong_type", expected=expected_type, got=claims.get("type"))
        return None
    return claims


def constant_time_eq(a: str, b: str) -> bool:
    """Timing-safe string comparison for token-hash lookups."""
    return hmac.compare_digest(a, b)
