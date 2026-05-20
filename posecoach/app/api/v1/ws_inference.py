from __future__ import annotations

import time
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.analysis.form_scorer import SUPPORTED_EXERCISES, score_exercise
from app.analysis.score_smoother import ScoreSmoother
from app.inference.runner import run_inference
from app.inference.smoother import KeypointSmoother

logger = structlog.get_logger(__name__)
router = APIRouter()

_NO_PERSON_RESPONSE: dict[str, Any] = {
    "keypoints": [],
    "confidence": [],
    "score": None,
    "cues": ["Step into frame"],
    "latency_ms": 0.0,
}


@router.websocket("/ws/inference")
async def ws_inference(websocket: WebSocket) -> None:
    """Real-time pose inference endpoint.

    Client sends: {"frame": "<base64 JPEG>", "exercise": "squat"}
    Server sends: {"keypoints", "confidence", "score", "cues", "latency_ms"}

    One EMA smoother instance per connection — reset on disconnect.
    JPEG frames are processed in-memory and never written to disk.
    """
    await websocket.accept()

    app = websocket.app
    model = app.state.model
    executor = app.state.executor

    kp_smoother = KeypointSmoother(alpha=0.6)
    score_smoother = ScoreSmoother(alpha=0.6)
    hold_start: float | None = None  # for plank hold tracking

    logger.info("ws_connected", client=websocket.client)

    try:
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

            logger.info(
                "frame_processed",
                exercise=exercise,
                score=round(smoothed_score, 1),
                latency_ms=round(latency_ms, 1),
            )

            await websocket.send_json(response)

    except WebSocketDisconnect:
        logger.info("ws_disconnected", client=websocket.client)
    finally:
        kp_smoother.reset()
        score_smoother.reset()
