"""Resolve the real client IP behind a known number of reverse proxies.

Behind the Hugging Face Space proxy (or any load balancer) the TCP peer is the
proxy, not the user, so keying rate limits on ``request.client.host`` puts every
user in one shared bucket: one abusive client can lock everyone out of login and
chat. Proxies append the address they received the request from to
``X-Forwarded-For``, so the trustworthy entry is the one ``TRUSTED_PROXY_HOPS``
positions from the *right*. Entries further left are client-supplied and can be
spoofed, which is why ``uvicorn --forwarded-allow-ips '*'`` (which trusts the
leftmost) is not used.

``TRUSTED_PROXY_HOPS=0`` (default) ignores the header entirely and keeps the old
behaviour — correct for local dev and for any deploy where the app is reachable
directly. Set it to the number of proxies in front of the app in production.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from starlette.requests import HTTPConnection

TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))
_UNKNOWN = "unknown"


def resolve_client_ip(headers: Mapping[str, str], peer: str | None, trusted_hops: int = TRUSTED_PROXY_HOPS) -> str:
    """Return the client IP for rate limiting / connection caps.

    Args:
        headers: Request headers (case-insensitive mapping in Starlette).
        peer: The TCP peer address (``request.client.host``), if any.
        trusted_hops: Number of trusted proxies in front of the app.

    Returns:
        The address the outermost trusted proxy saw, or ``peer`` when no proxy
        is trusted or the header is absent.
    """
    if trusted_hops > 0:
        forwarded = headers.get("x-forwarded-for", "")
        hops = [part.strip() for part in forwarded.split(",") if part.strip()]
        if hops:
            # Fewer entries than expected proxies: the leftmost is the best we have.
            return hops[-trusted_hops] if len(hops) >= trusted_hops else hops[0]
    return peer or _UNKNOWN


def client_ip(request: HTTPConnection) -> str:
    """Client IP for an HTTP request or WebSocket (slowapi ``key_func`` compatible).

    The parameter must be named ``request``: slowapi inspects the key function's
    signature and only passes the request when a parameter has that exact name.
    """
    peer = request.client.host if request.client else None
    return resolve_client_ip(request.headers, peer)
