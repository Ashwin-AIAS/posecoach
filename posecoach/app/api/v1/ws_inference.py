from __future__ import annotations

import contextlib
import time
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.analysis.form_scorer import SUPPORTED_EXERCISES, score_exercise
from app.analysis.score_smoother import ScoreSmoother
from app.auth.deps import ACCESS_COOKIE, get_user_from_cookie_optional
from app.db import AsyncSessionLocal
from app.inference.runner import run_inference
from app.inference.smoother import KeypointSmoother
from app.metrics import active_ws_connections, form_score, form_score_events_total
from app.models import WorkoutSession


def _grade(score: float) -> str:
    """Bucket a 0–100 form score into a coarse grade label for Prometheus."""
    if score >= 80.0:
        return "good"
    if score >= 50.0:
        return "fair"
    return "poor"

logger = structlog.get_logger(__name__)
router = APIRouter()

_NO_PERSON_RESPONSE: dict[str, Any] = {
    "keypoints": [],
    "confidence": [],
    "score": None,
    "cues": ["Step into frame"],
    "latency_ms": 0.0,
}

# How often to persist a keypoint snapshot to the session JSON column
SNAPSHOT_INTERVAL_S = 5.0

# One active inference socket per authenticated user. The Redis guard key carries
# a TTL so a crashed process self-heals; it is refreshed while frames keep flowing.
WS_CONN_TTL_S = 120


@router.websocket("/ws/inference")
async def ws_inference(websocket: WebSocket) -> None:
    """Real-time pose inference endpoint.

    Client sends: {"frame": "<base64 JPEG>", "exercise": "squat"}
    Server sends: {"keypoints", "confidence", "score", "cues", "latency_ms"}

    If the client is authenticated (access_token cookie present), a WorkoutSession
    row is created at connect and snapshots are appended every SNAPSHOT_INTERVAL_S
    seconds. Anonymous use is allowed — no session is persisted.

    JPEG frames are NEVER written to disk; only keypoint coords + scores are saved.
    """
    await websocket.accept()
    active_ws_connections.inc()

    app = websocket.app
    model = app.state.model
    executor = app.state.executor
    access_token = websocket.cookies.get(ACCESS_COOKIE)

    kp_smoother = KeypointSmoother(alpha=0.6)
    score_smoother = ScoreSmoother(alpha=0.6)
    hold_start: float | None = None  # for plank hold tracking

    session_id: str | None = None
    session_user_id: str | None = None
    session_exercise: str | None = None
    snapshots: list[dict[str, Any]] = []
    score_total = 0.0
    score_count = 0
    last_snapshot_t = 0.0

    # Resolve authenticated user (if any) via a short-lived DB session
    async with AsyncSessionLocal() as auth_db:
        user = await get_user_from_cookie_optional(access_token, auth_db)
        if user is not None:
            session_user_id = user.id

    logger.info("ws_connected", client=websocket.client, authenticated=bool(session_user_id))

    # One concurrent inference socket per authenticated user (Redis-backed).
    redis = app.state.redis
    conn_guard_key = f"ws:conn:{session_user_id}" if session_user_id else None
    guard_acquired = False

    try:
        if conn_guard_key is not None:
            try:
                guard_acquired = bool(await redis.set(conn_guard_key, "1", nx=True, ex=WS_CONN_TTL_S))
            except Exception as exc:  # noqa: BLE001 — a Redis hiccup must not lock users out
                logger.warning("ws_conn_guard_error", error=str(exc))
                guard_acquired = True  # fail open
            if not guard_acquired:
                logger.info("ws_duplicate_rejected", user_id=session_user_id)
                await websocket.send_json(
                    {"error": "active session exists in another tab", "code": "duplicate_connection"}
                )
                await websocket.close(code=1008)  # policy violation
                return

        while True:
            data: dict[str, Any] = await websocket.receive_json()

            frame_b64: str = data.get("frame", "")
            exercise: str = data.get("exercise", "squat").lower().strip()

            if not frame_b64:
                await websocket.send_json({"error": "missing frame"})
                continue

            if exercise not in SUPPORTED_EXERCISES:
                await websocket.send_json(
                    {"error": f"unsupported exercise '{exercise}'", "supported": sorted(SUPPORTED_EXERCISES)}
                )
                continue

            # Create the session row on the first valid frame (so we know the exercise)
            if session_user_id and session_id is None:
                async with AsyncSessionLocal() as ws_db:
                    row = WorkoutSession(
                        user_id=session_user_id,
                        exercise=exercise,
                        keypoints_data={"snapshots": []},
                    )
                    ws_db.add(row)
                    await ws_db.commit()
                    session_id = row.id
                    session_exercise = exercise
                last_snapshot_t = time.monotonic()

            result = await run_inference(model, executor, frame_b64)

            if result is None:
                if exercise == "plank":
                    hold_start = None
                await websocket.send_json(_NO_PERSON_RESPONSE)
                continue

            kp_xyn, kp_conf, latency_ms = result

            # Smooth keypoints
            kp_smooth = kp_smoother.update(kp_xyn)

            # Score form
            form = score_exercise(exercise, kp_smooth, kp_conf)

            # Smooth score
            smoothed_score = score_smoother.update(form.score)

            # Prometheus: per-frame form score (histogram + grade counter)
            form_score.labels(exercise=exercise).observe(smoothed_score)
            form_score_events_total.labels(exercise=exercise, grade=_grade(smoothed_score)).inc()

            # Plank hold tracking
            hold_s: float | None = None
            if exercise == "plank":
                if form.score >= 50.0:
                    if hold_start is None:
                        hold_start = time.monotonic()
                    hold_s = round(time.monotonic() - hold_start, 1)
                else:
                    hold_start = None

            response: dict[str, Any] = {
                "keypoints": kp_smooth.tolist(),
                "confidence": kp_conf.tolist(),
                "score": round(smoothed_score, 1),
                "cues": form.cues,
                "latency_ms": round(latency_ms, 1),
            }
            if hold_s is not None:
                response["hold_s"] = hold_s

            # Persist a snapshot every SNAPSHOT_INTERVAL_S seconds for authenticated users
            if session_id is not None:
                score_total += smoothed_score
                score_count += 1
                now = time.monotonic()
                if now - last_snapshot_t >= SNAPSHOT_INTERVAL_S:
                    snapshots.append(
                        {
                            "ts": time.time(),
                            "score": round(smoothed_score, 1),
                            "kp": kp_smooth.tolist(),
                        }
                    )
                    last_snapshot_t = now
                    # Keep the per-user connection guard alive while frames flow.
                    if conn_guard_key is not None and guard_acquired:
                        with contextlib.suppress(Exception):
                            await redis.expire(conn_guard_key, WS_CONN_TTL_S)

            await websocket.send_json(response)

    except WebSocketDisconnect:
        logger.info("ws_disconnected", client=websocket.client)
    finally:
        active_ws_connections.dec()
        kp_smoother.reset()
        score_smoother.reset()
        # Release the per-user guard so the user can reconnect immediately.
        if conn_guard_key is not None and guard_acquired:
            with contextlib.suppress(Exception):
                await redis.delete(conn_guard_key)
        if session_id is not None:
            try:
                async with AsyncSessionLocal() as close_db:
                    close_row = await close_db.get(WorkoutSession, session_id)
                    if close_row is not None:
                        avg = score_total / score_count if score_count else 0.0
                        close_row.avg_form_score = round(avg, 1)
                        close_row.ended_at = datetime.now(UTC)
                        close_row.keypoints_data = {"snapshots": snapshots, "exercise": session_exercise}
                        await close_db.commit()
                        logger.info(
                            "ws_session_closed",
                            session_id=session_id,
                            snapshots=len(snapshots),
                            avg=round(avg, 1),
                        )
            except Exception as exc:  # noqa: BLE001 — session close must never crash
                logger.error("ws_session_close_failed", error=str(exc))
