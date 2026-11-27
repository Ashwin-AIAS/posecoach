"""Reject oversized HTTP request bodies before they are buffered.

Without a cap, one unauthenticated request with a multi-hundred-MB body could
exhaust memory on the single-worker 2-vCPU Space (SECURITY_REVIEW.md M-1).
Pure ASGI (not ``BaseHTTPMiddleware``) so the body is checked as it streams,
and WebSocket / lifespan traffic passes straight through — WS frames have their
own per-message cap in ``ws_inference.py``.
"""

from __future__ import annotations

import os

import structlog
from starlette.requests import ClientDisconnect
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.get_logger(__name__)

# 1 MiB: the largest legitimate body is a chat request (512 KB snapshot +
# 10 history turns + query). Override with MAX_REQUEST_BODY_BYTES if needed.
MAX_REQUEST_BODY_BYTES = int(os.environ.get("MAX_REQUEST_BODY_BYTES", str(1024 * 1024)))


class BodySizeLimitMiddleware:
    """413 any HTTP request whose body exceeds ``max_bytes``."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast path: an honest Content-Length over the limit is rejected
        # without reading a single body byte.
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = 0
                if declared > self.max_bytes:
                    await self._reject(scope, send, declared)
                    return
                break

        # Slow path: chunked / lying Content-Length — count as it streams. On
        # overflow, answer 413 ourselves and hand the app a disconnect so it
        # stops reading; anything it tries to send afterwards is dropped. (Raising
        # instead would be caught by FastAPI's body parser and surface as a 400.)
        received = 0
        response_started = False
        rejected = False

        async def limited_receive() -> Message:
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    rejected = True
                    if not response_started:
                        await self._reject(scope, send, received)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if rejected:
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except ClientDisconnect:
            # The disconnect we injected after answering 413 surfaces here when the
            # app reads the body without a handler of its own — expected, not an
            # error. A genuine client disconnect (rejected is False) still raises.
            if not rejected:
                raise

    async def _reject(self, scope: Scope, send: Send, size: int) -> None:
        logger.warning("request_body_too_large", path=scope.get("path", ""), size=size, limit=self.max_bytes)
        body = b'{"detail":"Request body too large"}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
