"""Shared slowapi rate limiter.

A single ``Limiter`` instance is shared across every router so all endpoints
count against the same backing store and the same ``app.state.limiter`` that
``SlowAPIMiddleware`` reads. Keyed by the real client IP via
:func:`app.client_ip.client_ip`, which reads ``X-Forwarded-For`` from the
right-hand side according to ``TRUSTED_PROXY_HOPS`` — behind the HF Space proxy
the TCP peer is the proxy, so keying on it would put every user in one bucket.

The limiter is disabled when ``RATE_LIMIT_ENABLED`` is not "true". The test
suite sets it to "false" so repeated auth/chat calls don't trip the limit
across the shared module-level instance.
"""
from __future__ import annotations

import os

from slowapi import Limiter

from app.client_ip import client_ip

# Per-endpoint limits — referenced by the @limiter.limit decorators.
AUTH_RATE_LIMIT = "10/minute"  # login + register, per IP
CHAT_RATE_LIMIT = "10/minute"  # /chat/stream, per IP (Gemini free tier is 15/min)
NUTRITION_RATE_LIMIT = "10/minute"  # /nutrition/products lookups (OFF quota is 15/min/IP)
RECOVERY_RATE_LIMIT = "3/hour"  # forgot-password / forgot-username, per IP + per email (P33)

_RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"

limiter = Limiter(key_func=client_ip, enabled=_RATE_LIMIT_ENABLED)
