from __future__ import annotations

import asyncio
import contextlib
import os
import time
from collections import deque
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.analysis.exercise_verifier import MIN_VERDICT_CONFIDENCE, ExerciseVerifier
from app.analysis.form_scorer import (
    STATUS_INSUFFICIENT_CONFIDENCE,
    STATUS_MISMATCH,
    STATUS_OK,
    SUPPORTED_EXERCISES,
    score_exercise,
    worst_joint,
)
from app.analysis.keypoint_utils import compute_angles
from app.analysis.posing_scorer import STATUS_OK as POSING_STATUS_OK
from app.analysis.posing_scorer import (
    SUPPORTED_POSES,
    HoldTracker,
    score_pose,
)
from app.analysis.rep_counter import RepCounter
from app.analysis.score_smoother import ScoreSmoother
from app.auth.deps import ACCESS_COOKIE, get_user_from_cookie_optional
from app.db import AsyncSessionLocal
from app.inference.runner import run_inference
from app.inference.smoother import KeypointSmoother
from app.metrics import active_ws_connections, form_score, form_score_events_total
from app.models import WorkoutSession
from app.monitoring.metrics import pipeline_stage_latency_seconds


def _grade(score: float) -> str:
    """Bucket a 0–100 form score into a coarse grade label for Prometheus."""
    if score >= 80.0:
        return "good"
    if score >= 50.0:
        return "fair"
    return "poor"


# P11 instrumentation: how often to flush aggregated per-stage timing + the
# rep-counter state audit to the logs. Per-frame logging would flood the stream.
DIAG_LOG_EVERY = 30
# Rolling window of recent per-stage samples used to compute mean + p95 in the
# periodic timing log (kept bounded so a long session never grows memory).
DIAG_WINDOW = 300


def _percentile(samples: list[float], pct: float) -> float:
    """Linear-interpolated percentile (0.0–1.0) of ``samples``; 0.0 if empty."""
    if not samples:
        return 0.0
    ordered = sorted(samples)
    rank = (len(ordered) - 1) * pct
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def _stage_summary(window: dict[str, deque[float]]) -> dict[str, float]:
    """Flatten per-stage timing windows into mean_ms / p95_ms log fields."""
    out: dict[str, float] = {}
    for stage, samples in window.items():
        data = list(samples)
        if not data:
            continue
        out[f"{stage}_mean_ms"] = round(sum(data) / len(data), 2)
        out[f"{stage}_p95_ms"] = round(_percentile(data, 0.95), 2)
    return out


logger = structlog.get_logger(__name__)
router = APIRouter()

_NO_PERSON_RESPONSE: dict[str, Any] = {
    "keypoints": [],
    "confidence": [],
    "score": None,
    "cues": ["Step into frame"],
    "latency_ms": 0.0,
    # Explicit "no person detected" — distinct from a real low score (P13).
    "status": "no_person",
}

# How often to persist a keypoint snapshot to the session JSON column
SNAPSHOT_INTERVAL_S = 5.0

# One active inference socket per authenticated user. The Redis guard key carries
# a TTL so a crashed process self-heals; it is refreshed while frames keep flowing.
WS_CONN_TTL_S = 120

# Reject oversized frames before they reach the base64 decoder / inference
# executor. The frontend's capture profiles (320x240-256x192 JPEG) base64-encode
# to ~15-40 KB; 256 KB is generous headroom for any legitimate frame while
# stopping a single multi-MB payload from stalling the shared worker.
MAX_FRAME_BYTES = 256 * 1024

# Connection ceilings (process-local DoS guards). The per-user Redis guard above
# dedups one authenticated user's tabs; these cap raw socket pressure regardless
# of auth. Process-local accounting is sufficient for the single-worker deploy and
# avoids the leak-on-crash hazard of a TTL-less distributed counter — documented
# as a per-process ceiling. Both are env-overridable.
MAX_WS_CONNECTIONS = int(os.environ.get("MAX_WS_CONNECTIONS", "64"))
MAX_ANON_CONNS_PER_IP = int(os.environ.get("MAX_ANON_CONNS_PER_IP", "3"))

# Live per-process connection accounting for the ceilings above.
_active_ws_count = 0
_anon_ip_counts: dict[str, int] = {}


@router.websocket("/ws/inference")
async def ws_inference(websocket: WebSocket) -> None:
    """Real-time pose inference endpoint.

    Client sends: {"frame": "<base64 JPEG>", "exercise": "squat"}
    Server sends: {"keypoints", "confidence", "score", "cues", "latency_ms",
    "joint_scores", "worst_joint", "rep_state", "measured_angles", "reps"}

    If the client is authenticated (access_token cookie present), a WorkoutSession
    row is created at connect and snapshots are appended every SNAPSHOT_INTERVAL_S
    seconds. Anonymous use is allowed — no session is persisted.

    JPEG frames are NEVER written to disk; only keypoint coords + scores are saved.
    """
    global _active_ws_count

    await websocket.accept()
    active_ws_connections.inc()

    # Connection accounting for the ceilings below — `admitted`/`anon_ip_counted`
    # gate the matching decrements in the finally block so the counters stay
    # balanced no matter which path exits.
    client_ip = websocket.client.host if websocket.client else "unknown"
    admitted = False
    anon_ip_counted = False

    app = websocket.app
    model = app.state.model
    executor = app.state.executor
    access_token = websocket.cookies.get(ACCESS_COOKIE)

    kp_smoother = KeypointSmoother(alpha=0.6)
    score_smoother = ScoreSmoother(alpha=0.6)
    hold_tracker = HoldTracker()  # posing-mode hold duration + steadiness (P15)
    posing_pose: str | None = None  # active pose id; reset hold on change
    hold_start: float | None = None  # for plank hold tracking
    rep_counter: RepCounter | None = None  # created on first frame; reset on exercise change
    verifier: ExerciseVerifier | None = None  # exercise-match gate (P13); per connection

    # P11 instrumentation (per connection): rolling per-stage timing windows, a
    # processed-frame counter that drives the every-30-frames diagnostic flush,
    # and a one-shot flag that logs the response payload schema exactly once.
    stage_windows: dict[str, deque[float]] = {}
    processed_frames = 0
    schema_logged = False

    session_id: str | None = None
    session_user_id: str | None = None
    session_exercise: str | None = None
    # "exercise" or "posing" (P16) — set when the session row is created so the
    # close logic and snapshot accounting only ever touch the matching mode.
    session_type: str = "exercise"
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

    # Single-slot latest-frame buffer (last-write-wins). A background receiver
    # overwrites it as frames arrive; the processor below always works on the
    # freshest frame and discards any stale ones, so a slow inference pass can
    # never build a backlog that inflates perceived latency.
    latest_frame: dict[str, Any] | None = None
    frame_ready = asyncio.Event()
    receiver_done = asyncio.Event()
    dropped_frames = 0
    recv_task: asyncio.Task[None] | None = None

    async def _receive_frames() -> None:
        """Continuously read frames into the single slot, dropping stale ones."""
        nonlocal latest_frame, dropped_frames
        try:
            while True:
                msg: dict[str, Any] = await websocket.receive_json()
                if latest_frame is not None:
                    dropped_frames += 1  # overwrote a frame the processor never consumed
                latest_frame = msg
                frame_ready.set()
        except WebSocketDisconnect:
            pass
        finally:
            receiver_done.set()
            frame_ready.set()  # wake the processor so it can exit

    try:
        # Connection ceilings — reject before any per-frame work. The finally
        # below always runs (it owns active_ws_connections.dec()); the
        # admitted/anon_ip_counted flags keep the process counters balanced.
        if _active_ws_count >= MAX_WS_CONNECTIONS:
            logger.warning("ws_global_cap_reached", limit=MAX_WS_CONNECTIONS, ip=client_ip)
            await websocket.send_json({"error": "server at capacity", "code": "capacity"})
            await websocket.close(code=1013)  # 1013 = try again later
            return
        if session_user_id is None and _anon_ip_counts.get(client_ip, 0) >= MAX_ANON_CONNS_PER_IP:
            logger.info("ws_anon_ip_cap_reached", limit=MAX_ANON_CONNS_PER_IP, ip=client_ip)
            await websocket.send_json(
                {"error": "too many anonymous connections", "code": "anon_limit"}
            )
            await websocket.close(code=1008)  # 1008 = policy violation
            return
        _active_ws_count += 1
        admitted = True
        if session_user_id is None:
            _anon_ip_counts[client_ip] = _anon_ip_counts.get(client_ip, 0) + 1
            anon_ip_counted = True

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

        recv_task = asyncio.create_task(_receive_frames())

        while True:
            await frame_ready.wait()
            frame_ready.clear()
            # Atomic take (no await between read and clear): newest frame wins.
            data = latest_frame
            latest_frame = None
            if data is None:
                if receiver_done.is_set():
                    break  # client disconnected and the slot is drained
                continue

            frame_proc_t0 = time.perf_counter()
            frame_b64: str = data.get("frame", "")
            mode: str = data.get("mode", "exercise").lower().strip()
            exercise: str = data.get("exercise", "squat").lower().strip()

            if not frame_b64:
                await websocket.send_json({"error": "missing frame"})
                continue

            if len(frame_b64) > MAX_FRAME_BYTES:
                logger.warning("ws_frame_too_large", frame_chars=len(frame_b64), limit=MAX_FRAME_BYTES)
                await websocket.send_json({"error": "frame too large", "max_bytes": MAX_FRAME_BYTES})
                continue

            # Posing mode (P15): score a held bodybuilding pose instead of a
            # rep-based exercise. No rep counter / verifier / DB session here —
            # posing-session persistence lands in P16.
            if mode == "posing":
                pose: str = data.get("pose", "front_double_biceps").lower().strip()
                if pose not in SUPPORTED_POSES:
                    await websocket.send_json(
                        {"error": f"unsupported pose '{pose}'", "supported_poses": sorted(SUPPORTED_POSES)}
                    )
                    continue
                if pose != posing_pose:
                    posing_pose = pose
                    hold_tracker.reset()
                    score_smoother.reset()

                # Create the posing session row on the first valid posing frame
                # for authenticated users (P16). ``exercise`` holds the pose id.
                # Only created when no session exists yet, so an exercise session
                # already open on this socket is never repurposed.
                if session_user_id and session_id is None:
                    async with AsyncSessionLocal() as pose_db:
                        pose_row = WorkoutSession(
                            user_id=session_user_id,
                            exercise=pose,
                            session_type="posing",
                            keypoints_data={"snapshots": []},
                        )
                        pose_db.add(pose_row)
                        await pose_db.commit()
                        session_id = pose_row.id
                        session_exercise = pose
                        session_type = "posing"
                    last_snapshot_t = time.monotonic()

                pose_inf = await run_inference(model, executor, frame_b64)
                if pose_inf is None:
                    hold_tracker.reset()
                    await websocket.send_json(
                        {
                            "keypoints": [],
                            "confidence": [],
                            "score": None,
                            "symmetry": None,
                            "cues": ["Step into frame"],
                            "hold": {"seconds": 0.0, "stability": 0.0, "steady": False},
                            "latency_ms": 0.0,
                            "status": "no_person",
                        }
                    )
                    continue

                kp_smooth_pose = kp_smoother.update(pose_inf.kp_xyn)
                pose_result = score_pose(pose, kp_smooth_pose, pose_inf.kp_conf)

                if pose_result.status == POSING_STATUS_OK:
                    smoothed_pose_score = score_smoother.update(pose_result.score)
                    hold = hold_tracker.update(
                        smoothed_pose_score, kp_smooth_pose, pose_inf.kp_conf, time.monotonic()
                    )
                    score_value: float | None = round(smoothed_pose_score, 1)
                    # Symmetry is null in profile (P16) — meaningless when occluded.
                    symmetry_value: float | None = (
                        round(pose_result.symmetry_score, 1)
                        if pose_result.symmetry_applicable
                        else None
                    )
                    # Persist a snapshot every SNAPSHOT_INTERVAL_S for the posing session.
                    if session_id is not None and session_type == "posing":
                        score_total += smoothed_pose_score
                        score_count += 1
                        now = time.monotonic()
                        if now - last_snapshot_t >= SNAPSHOT_INTERVAL_S:
                            snapshots.append(
                                {
                                    "ts": time.time(),
                                    "score": round(smoothed_pose_score, 1),
                                    "kp": kp_smooth_pose.tolist(),
                                }
                            )
                            last_snapshot_t = now
                            if conn_guard_key is not None and guard_acquired:
                                with contextlib.suppress(Exception):
                                    await redis.expire(conn_guard_key, WS_CONN_TTL_S)
                else:
                    # No meaningful score this frame (low confidence / wrong way).
                    score_smoother.reset()
                    hold_tracker.reset()
                    hold = hold_tracker.update(
                        0.0, kp_smooth_pose, pose_inf.kp_conf, time.monotonic()
                    )
                    score_value = None
                    symmetry_value = None

                await websocket.send_json(
                    {
                        "keypoints": kp_smooth_pose.tolist(),
                        "confidence": pose_inf.kp_conf.tolist(),
                        "score": score_value,
                        "symmetry": symmetry_value,
                        "cues": pose_result.cues,
                        "hold": {
                            "seconds": hold.seconds,
                            "stability": hold.stability,
                            "steady": hold.steady,
                        },
                        "check_scores": pose_result.check_scores,
                        "orientation": pose_result.orientation,
                        "latency_ms": round(pose_inf.latency_ms, 1),
                        "status": pose_result.status,
                    }
                )
                logger.info(
                    "ws_posing_frame",
                    pose=pose,
                    orientation=pose_result.orientation,
                    status=pose_result.status,
                    hold_s=hold.seconds,
                )
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
                # Keep the running rep count on screen during a brief dropout so a
                # flicker of no-detection doesn't blank the counter (P12).
                no_person = dict(_NO_PERSON_RESPONSE)
                if rep_counter is not None:
                    no_person["reps"] = rep_counter.count
                    no_person["rep_state"] = rep_counter.state
                await websocket.send_json(no_person)
                continue

            kp_xyn = result.kp_xyn
            kp_conf = result.kp_conf
            latency_ms = result.latency_ms

            # Smooth keypoints
            t_ks0 = time.perf_counter()
            kp_smooth = kp_smoother.update(kp_xyn)
            t_ks1 = time.perf_counter()

            # Score form
            form = score_exercise(exercise, kp_smooth, kp_conf)
            t_scoring = time.perf_counter()

            # Rep counting (streaming, deterministic) — reset on exercise change
            if rep_counter is None or rep_counter.exercise != exercise:
                rep_counter = RepCounter(exercise)
            # Keep the rep counter's angle view named so the P11 audit can count
            # how many tracked joints actually carried a valid (non-None) angle.
            frame_angles = compute_angles(kp_smooth, kp_conf)
            reps = rep_counter.update(frame_angles)
            t_rep = time.perf_counter()

            # Exercise-verification gate (P13): does the observed movement match the
            # chosen exercise? Window-based, so it warms up over a few seconds.
            if verifier is None or verifier.exercise != exercise:
                verifier = ExerciseVerifier(exercise)
            verdict = verifier.update(frame_angles)

            # A person is visible but no tracked joint cleared the confidence gate
            # (P13). Report this explicitly with a null score instead of feeding a
            # fake 0.0 into the smoother / metrics / session average — which would
            # read as terrible form. The rep count is preserved so the UI holds.
            if form.status == STATUS_INSUFFICIENT_CONFIDENCE:
                await websocket.send_json(
                    {
                        "keypoints": kp_smooth.tolist(),
                        "confidence": kp_conf.tolist(),
                        "score": None,
                        "cues": form.cues,
                        "latency_ms": round(latency_ms, 1),
                        "reps": reps,
                        "rep_state": rep_counter.state,
                        "status": STATUS_INSUFFICIENT_CONFIDENCE,
                    }
                )
                continue

            # Wrong-exercise gate (P13): the movement clearly does not match the
            # chosen exercise (e.g. RDL while "deadlift" is selected, or a machine
            # row while "row" is selected). Suppress the score so a mismatched rep
            # is never read as good form — surface a plain-English hint instead.
            if not verdict.verified and verdict.confidence >= MIN_VERDICT_CONFIDENCE:
                score_smoother.reset()  # don't carry a stale score across the gap
                await websocket.send_json(
                    {
                        "keypoints": kp_smooth.tolist(),
                        "confidence": kp_conf.tolist(),
                        "score": None,
                        "cues": [verdict.detected_hint] if verdict.detected_hint else [],
                        "latency_ms": round(latency_ms, 1),
                        "reps": reps,
                        "rep_state": rep_counter.state,
                        "status": STATUS_MISMATCH,
                        # The exercise the movement was checked against — drives the
                        # "doesn't look like {exercise}" banner on the client.
                        "expected_exercise": exercise,
                    }
                )
                continue

            # Smooth score
            smoothed_score = score_smoother.update(form.score)
            t_ss = time.perf_counter()

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
                # Per-joint 0–100 scores power the coaching panel's per-joint bars.
                "joint_scores": {k: round(v, 1) for k, v in form.joint_scores.items()},
                # Lowest-scoring joint — drives the overlay's worst-joint spotlight.
                "worst_joint": worst_joint(form.joint_scores),
                # Rep phase ("up"/"down"/"hold") — drives trails, breathing, particles.
                "rep_state": rep_counter.state,
                # Raw measured angles (degrees) per scored joint — drives the arcs.
                "measured_angles": {k: round(v, 1) for k, v in form.measured_angles.items()},
                "reps": reps,
                # Explicit "scored normally" marker (P13) — the client distinguishes
                # this from no_person / insufficient_confidence frames.
                "status": STATUS_OK,
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

            t_send0 = time.perf_counter()
            await websocket.send_json(response)
            t_send1 = time.perf_counter()

            # Log the response payload schema exactly once per connection so we
            # can verify (in P11) that `reps` is actually in the JSON the client
            # receives. Key names + booleans only — never keypoint/frame data.
            if not schema_logged:
                schema_logged = True
                logger.info(
                    "ws_response_schema",
                    keys=sorted(response.keys()),
                    has_reps_field="reps" in response,
                    has_rep_state_field="rep_state" in response,
                )

            # Record per-stage timing into both the rolling window (for the
            # periodic mean/p95 log) and the Prometheus stage histogram.
            stage_ms = {
                "frame_decode": result.decode_ms,
                "inference": result.predict_ms,
                "keypoint_smooth": (t_ks1 - t_ks0) * 1000.0,
                "scoring": (t_scoring - t_ks1) * 1000.0,
                "rep_count": (t_rep - t_scoring) * 1000.0,
                "score_smooth": (t_ss - t_rep) * 1000.0,
                "serialize_send": (t_send1 - t_send0) * 1000.0,
                "total_loop": (t_send1 - frame_proc_t0) * 1000.0,
            }
            for stage, ms in stage_ms.items():
                stage_windows.setdefault(stage, deque(maxlen=DIAG_WINDOW)).append(ms)
                pipeline_stage_latency_seconds.labels(stage=stage, exercise=exercise).observe(ms / 1000.0)

            processed_frames += 1

            # Per-frame end-to-end latency (decode→inference→score→serialize),
            # plus the model-only slice and how many stale frames were dropped.
            logger.info(
                "ws_frame_processed",
                latency_ms=round(stage_ms["total_loop"], 1),
                model_latency_ms=round(latency_ms, 1),
                exercise=exercise,
                dropped_frames=dropped_frames,
            )

            # Every 30 frames, flush aggregated stage timing + a rep-counter
            # state audit. The audit's `valid_angle_count` is the key signal for
            # the "reps stuck at 0" bug: if tracked joints arrive as None (their
            # keypoints gated out below conf 0.5), no flex→extend cycle can fire.
            if processed_frames % DIAG_LOG_EVERY == 0:
                logger.info(
                    "ws_pipeline_timing",
                    exercise=exercise,
                    frames=processed_frames,
                    **_stage_summary(stage_windows),
                )
                valid_angle_count = sum(1 for j in rep_counter.tracked_joints if frame_angles.get(j) is not None)
                logger.info(
                    "ws_rep_audit",
                    exercise=exercise,
                    state=rep_counter.state,
                    count=rep_counter.count,
                    reps_sent=reps,
                    down_thr=rep_counter.down_thr,
                    up_thr=rep_counter.up_thr,
                    is_isometric=rep_counter.down_thr is None,
                    tracked_joints=len(rep_counter.tracked_joints),
                    valid_angle_count=valid_angle_count,
                    rep_counter_id=id(rep_counter),
                )

    except WebSocketDisconnect:
        logger.info("ws_disconnected", client=websocket.client)
    finally:
        active_ws_connections.dec()
        if admitted:
            _active_ws_count -= 1
        if anon_ip_counted:
            remaining = _anon_ip_counts.get(client_ip, 1) - 1
            if remaining <= 0:
                _anon_ip_counts.pop(client_ip, None)
            else:
                _anon_ip_counts[client_ip] = remaining
        if recv_task is not None:
            recv_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await recv_task
        kp_smoother.reset()
        score_smoother.reset()
        hold_tracker.reset()
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
                        close_row.rep_count = rep_counter.count if rep_counter is not None else 0
                        close_row.ended_at = datetime.now(UTC)
                        close_row.keypoints_data = {"snapshots": snapshots, "exercise": session_exercise}
                        await close_db.commit()
                        logger.info(
                            "ws_session_closed",
                            session_id=session_id,
                            snapshots=len(snapshots),
                            avg=round(avg, 1),
                            reps=close_row.rep_count,
                        )
            except Exception as exc:  # noqa: BLE001 — session close must never crash
                logger.error("ws_session_close_failed", error=str(exc))
