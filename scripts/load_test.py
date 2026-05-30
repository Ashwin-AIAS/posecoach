"""Locust load test for PoseCoach — P09 production hardening.

Two user classes run concurrently against the live stack:

  * ``InferenceUser`` — streams JPEG frames over the inference WebSocket and
    measures per-frame round-trip latency. Connects **anonymously** on purpose:
    the per-user concurrency guard (``ws:conn:{user_id}``) would otherwise reject
    every user after the first if they shared one account, so anonymous sockets
    are what give a true 10-concurrent latency reading.

  * ``ApiUser`` — exercises the REST surface. Register + login happen once and
    tolerate HTTP 429 (the rate limiter engaging is *correct* behaviour, not an
    error). Steady-state load is ``/auth/me`` + ``/history/sessions``, which are
    cookie-authenticated and **not** IP-rate-limited, so they carry the
    "0% error rate" target.

Thesis done-criteria (P09):
    10 concurrent WS users · 60 s · inference p95 < 100 ms · 0% error on read paths.

Run against the running stack (backend on :8000):

    pip install -r requirements-dev.txt        # locust + websocket-client
    locust -f scripts/load_test.py --host http://localhost:8000 \\
           --users 12 --spawn-rate 4 --run-time 60s --headless

A PASS/FAIL summary against the thesis gates is printed on test stop.
"""
from __future__ import annotations

import base64
import json
import time
import uuid
from io import BytesIO
from typing import Any

from locust import HttpUser, User, between, events, task
from PIL import Image

try:
    import websocket  # from the websocket-client package
except ImportError:  # pragma: no cover - dependency hint
    websocket = None  # type: ignore[assignment]

# ── Thesis gates ──────────────────────────────────────────────────────────────
INFERENCE_P95_BUDGET_MS = 100.0
WS_REQUEST_NAME = "ws:inference_frame"
READ_PATH_NAMES = ("auth:me", "history:list")
FRAMES_PER_TASK = 10

_EXERCISES = ("squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank")


def _make_frame_b64() -> str:
    """A small grey JPEG — representative payload without shipping a real photo."""
    img = Image.new("RGB", (320, 240), color=(180, 180, 180))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


_FRAME_B64 = _make_frame_b64()


def _ws_url(host: str) -> str:
    """Derive ws(s)://host/ws/inference from the Locust --host value."""
    scheme = "wss" if host.startswith("https") else "ws"
    netloc = host.split("://", 1)[-1].rstrip("/")
    return f"{scheme}://{netloc}/ws/inference"


class InferenceUser(User):
    """Anonymous WebSocket client — the primary latency-under-load workload."""

    wait_time = between(0.5, 1.5)

    @task
    def stream_frames(self) -> None:
        if websocket is None:
            raise RuntimeError("websocket-client not installed — pip install websocket-client")

        url = _ws_url(self.host or "http://localhost:8000")
        exercise = _EXERCISES[int(time.time()) % len(_EXERCISES)]
        try:
            ws = websocket.create_connection(url, timeout=10)
        except Exception as exc:  # noqa: BLE001 - report connect failure to Locust
            events.request.fire(
                request_type="WS", name="ws:connect", response_time=0,
                response_length=0, exception=exc,
            )
            return

        try:
            for _ in range(FRAMES_PER_TASK):
                payload = json.dumps({"frame": _FRAME_B64, "exercise": exercise})
                start = time.perf_counter()
                ws.send(payload)
                raw = ws.recv()
                elapsed_ms = (time.perf_counter() - start) * 1000.0
                exc: Exception | None = None
                try:
                    msg: dict[str, Any] = json.loads(raw)
                    if "error" in msg:
                        exc = AssertionError(f"server error: {msg['error']}")
                except (ValueError, TypeError) as parse_exc:
                    exc = parse_exc
                events.request.fire(
                    request_type="WS", name=WS_REQUEST_NAME,
                    response_time=elapsed_ms, response_length=len(raw or ""), exception=exc,
                )
                time.sleep(1.0 / 15.0)  # cap at ~15 FPS, matching the frontend
        finally:
            ws.close()


class ApiUser(HttpUser):
    """REST traffic: register/login once (429-tolerant), then steady reads."""

    wait_time = between(1.0, 3.0)

    def on_start(self) -> None:
        self.email = f"loadtest_{uuid.uuid4().hex[:12]}@example.com"
        self.password = "LoadTest123!"
        creds = {"email": self.email, "password": self.password}

        with self.client.post(
            "/api/v1/auth/register", json=creds, name="auth:register", catch_response=True
        ) as resp:
            # 201 created, 409 already-exists, or 429 rate-limited are all acceptable.
            if resp.status_code in (201, 409, 429):
                resp.success()
        with self.client.post(
            "/api/v1/auth/login", json=creds, name="auth:login", catch_response=True
        ) as resp:
            if resp.status_code in (200, 429):
                resp.success()

    @task(3)
    def me(self) -> None:
        self.client.get("/api/v1/auth/me", name="auth:me")

    @task(2)
    def history(self) -> None:
        self.client.get("/api/v1/history/sessions", name="history:list")

    @task(1)
    def health(self) -> None:
        self.client.get("/health", name="health")


@events.quitting.add_listener
def _assert_thesis_gates(environment: Any, **_kwargs: Any) -> None:
    """Print a PASS/FAIL summary and set a non-zero exit code if a gate fails."""
    stats = environment.stats
    failed = False

    ws_entry = stats.get(WS_REQUEST_NAME, "WS")
    if ws_entry is not None and ws_entry.num_requests > 0:
        p95 = ws_entry.get_response_time_percentile(0.95)
        ok = p95 < INFERENCE_P95_BUDGET_MS
        failed = failed or not ok
        print(f"[gate] inference p95 = {p95:.1f}ms (budget {INFERENCE_P95_BUDGET_MS}ms) "
              f"-> {'PASS' if ok else 'FAIL'}  over {ws_entry.num_requests} frames")
    else:
        print("[gate] inference p95 = NO DATA -> FAIL")
        failed = True

    for name in READ_PATH_NAMES:
        entry = stats.get(name, "GET")
        if entry is None or entry.num_requests == 0:
            continue
        ok = entry.num_failures == 0
        failed = failed or not ok
        print(f"[gate] {name}: {entry.num_failures}/{entry.num_requests} failures "
              f"-> {'PASS' if ok else 'FAIL'}")

    if failed:
        print("[gate] LOAD TEST FAILED — see gates above")
        environment.process_exit_code = 1
    else:
        print("[gate] LOAD TEST PASSED — all P09 thesis gates met")
        environment.process_exit_code = 0
