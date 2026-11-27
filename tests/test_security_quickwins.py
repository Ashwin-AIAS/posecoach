"""Security quick wins: real client IP, body cap, decode-bomb guard, chat frame cap.

Each test maps to a finding in SECURITY_REVIEW.md (H-1, M-1, M-4) or to the
rate-limit keying bug (every user behind the HF proxy sharing one bucket).
"""

from __future__ import annotations

import base64
from io import BytesIO

import pytest
from PIL import Image
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.api.v1.chat import MAX_CHAT_FRAME_CHARS, ChatRequest
from app.client_ip import resolve_client_ip
from app.inference import runner
from app.middleware.body_limit import BodySizeLimitMiddleware

# --- client IP resolution -------------------------------------------------


def test_client_ip_without_trusted_proxy_uses_peer() -> None:
    headers = {"x-forwarded-for": "6.6.6.6"}
    assert resolve_client_ip(headers, "10.0.0.1", trusted_hops=0) == "10.0.0.1"


def test_client_ip_one_hop_takes_rightmost_entry() -> None:
    # The proxy appended the real client (1.2.3.4) after a spoofed value.
    headers = {"x-forwarded-for": "6.6.6.6, 1.2.3.4"}
    assert resolve_client_ip(headers, "10.0.0.1", trusted_hops=1) == "1.2.3.4"


def test_client_ip_spoofed_header_cannot_choose_its_own_bucket() -> None:
    a = resolve_client_ip({"x-forwarded-for": "9.9.9.1, 1.2.3.4"}, "10.0.0.1", trusted_hops=1)
    b = resolve_client_ip({"x-forwarded-for": "9.9.9.2, 1.2.3.4"}, "10.0.0.1", trusted_hops=1)
    assert a == b == "1.2.3.4"


def test_client_ip_two_hops() -> None:
    headers = {"x-forwarded-for": "6.6.6.6, 1.2.3.4, 172.16.0.9"}
    assert resolve_client_ip(headers, "10.0.0.1", trusted_hops=2) == "1.2.3.4"


def test_client_ip_trusted_but_header_missing_falls_back_to_peer() -> None:
    assert resolve_client_ip({}, "10.0.0.1", trusted_hops=1) == "10.0.0.1"


def test_client_ip_no_peer_is_unknown() -> None:
    assert resolve_client_ip({}, None, trusted_hops=0) == "unknown"


# --- request body cap -------------------------------------------------------


async def _echo(request: Request) -> JSONResponse:
    body = await request.body()
    return JSONResponse({"size": len(body)})


def _app(limit: int) -> TestClient:
    app = Starlette(routes=[Route("/echo", _echo, methods=["POST"])])
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=limit)
    return TestClient(app)


def test_body_under_limit_passes() -> None:
    r = _app(100).post("/echo", content=b"x" * 100)
    assert r.status_code == 200
    assert r.json() == {"size": 100}


def test_body_over_declared_limit_rejected_413() -> None:
    r = _app(100).post("/echo", content=b"x" * 101)
    assert r.status_code == 413


def test_chunked_body_over_limit_rejected_413() -> None:
    def chunks():  # type: ignore[no-untyped-def]
        for _ in range(10):
            yield b"x" * 50

    r = _app(100).post("/echo", content=chunks())
    assert r.status_code == 413


# --- decompression bomb ------------------------------------------------------


def _jpeg_b64(w: int, h: int) -> str:
    buf = BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_decode_normal_frame_ok() -> None:
    frame, meta = runner._decode_frame(_jpeg_b64(384, 512), 640)
    assert frame.shape == (640, 640, 3)
    assert (meta.src_w, meta.src_h) == (384, 512)


def test_decode_rejects_oversized_canvas(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "MAX_DECODE_PIXELS", 100 * 100)
    with pytest.raises(ValueError, match="too large"):
        runner._decode_frame(_jpeg_b64(200, 200), 640)


# --- chat frame cap ----------------------------------------------------------


def test_chat_frame_at_cap_accepted() -> None:
    assert ChatRequest(query="hi", frame="a" * MAX_CHAT_FRAME_CHARS).frame is not None


def test_chat_frame_over_cap_rejected() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(query="hi", frame="a" * (MAX_CHAT_FRAME_CHARS + 1))


def test_real_app_rejects_oversized_chat_body_with_413() -> None:
    # Through the full production middleware stack (no lifespan needed: the
    # cap fires before routing), both an honest Content-Length and a chunked body.
    from app.main import app

    client = TestClient(app)
    big = b"{" + b" " * (2 * 1024 * 1024) + b"}"
    assert client.post("/api/v1/chat/stream", content=big).status_code == 413

    def chunks():  # type: ignore[no-untyped-def]
        for _ in range(40):
            yield b" " * (64 * 1024)

    assert client.post("/api/v1/chat/stream", content=chunks()).status_code == 413
