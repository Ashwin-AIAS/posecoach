"""Shared slowapi rate limiter.

A single ``Limiter`` instance is shared across every router so all endpoints
count against the same backing store and the same ``app.state.limiter`` that
``SlowAPIMiddleware`` reads. Keyed by client IP via ``get_remote_address``.

Behind NGINX the real client IP only reaches the app when uvicorn runs with
``--proxy-headers``; the production compose enables it so the limiter keys on
the end user, not the proxy.

The limiter is disabled when ``RATE_LIMIT_ENABLED`` is not "true". The test
suite sets it to "false" so repeated auth/chat calls don't trip the limit
across the shared module-level instance.
"""
from __future__ import annotations

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

# Per-endpoint limits — referenced by the @limiter.limit decorators.
AUTH_RATE_LIMIT = "10/minute"  # login + register, per IP
CHAT_RATE_LIMIT = "10/minute"  # /chat/stream, per IP (Gemini free tier is 15/min)
NUTRITION_RATE_LIMIT = "10/minute"  # /nutrition/products lookups (OFF quota is 15/min/IP)

_RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"

limiter = Limiter(key_func=get_remote_address, enabled=_RATE_LIMIT_ENABLED)
