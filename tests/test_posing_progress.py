"""Posing progress analytics (P18) — per-pose trends across a prep.

Covers the deterministic summarizer (``app/analysis/posing_progress.py``) and the
``GET /preps/{id}/progress`` endpoint (weeks-out timeline + IDOR protection).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.posing_progress import summarize_posing_progress
from app.models import PrepCycle, User, WorkoutSession

# COCO indices (mirror tests/test_posing_scorer.py).
_NOSE, _LEYE, _REYE, _LEAR, _REAR = 0, 1, 2, 3, 4
_LSH, _RSH, _LEL, _REL, _LWR, _RWR = 5, 6, 7, 8, 9, 10
_LHIP, _RHIP, _LKNE, _RKNE, _LANK, _RANK = 11, 12, 13, 14, 15, 16


def _front_double_biceps() -> list[list[float]]:
    """A front-facing double-biceps skeleton that scores well and is symmetric."""
    kp = [[0.0, 0.0] for _ in range(17)]
    kp[_NOSE], kp[_LEYE], kp[_REYE] = [0.50, 0.12], [0.53, 0.10], [0.47, 0.10]
    kp[_LEAR], kp[_REAR] = [0.56, 0.11], [0.44, 0.11]
    kp[_LSH], kp[_RSH] = [0.62, 0.27], [0.38, 0.27]
    kp[_LEL], kp[_REL] = [0.72, 0.20], [0.28, 0.20]
    kp[_LWR], kp[_RWR] = [0.68, 0.10], [0.32, 0.10]
    kp[_LHIP], kp[_RHIP] = [0.57, 0.55], [0.43, 0.55]
    kp[_LKNE], kp[_RKNE] = [0.585, 0.78], [0.415, 0.78]
    kp[_LANK], kp[_RANK] = [0.61, 0.98], [0.39, 0.98]
    return kp


def _side_pose() -> list[list[float]]:
    """A profile skeleton (symmetry is meaningless in profile)."""
    kp = [[0.0, 0.0] for _ in range(17)]
    kp[_NOSE], kp[_LEYE], kp[_REYE] = [0.48, 0.12], [0.47, 0.10], [0.49, 0.10]
    kp[_LSH], kp[_RSH] = [0.50, 0.30], [0.47, 0.30]
    kp[_LEL], kp[_REL] = [0.52, 0.42], [0.49, 0.42]
    kp[_LWR], kp[_RWR] = [0.53, 0.52], [0.50, 0.52]
    kp[_LHIP], kp[_RHIP] = [0.50, 0.55], [0.48, 0.55]
    kp[_LKNE], kp[_RKNE] = [0.58, 0.72], [0.47, 0.78]
    kp[_LANK], kp[_RANK] = [0.53, 0.92], [0.47, 1.00]
    return kp


def _jitter(kp: list[list[float]], dx: float) -> list[list[float]]:
    """Shift every keypoint x by dx — introduces drift so steadiness drops below 100."""
    return [[x + dx, y] for x, y in kp]


def _posing_session(
    *,
    sid: str,
    uid: str,
    pose: str,
    snaps_kp: list[list[list[float]]],
    started_at: datetime,
    prep_id: str | None = None,
    session_type: str = "posing",
) -> WorkoutSession:
    """In-memory posing session with the given keypoint snapshots."""
    return WorkoutSession(
        id=sid,
        user_id=uid,
        exercise=pose,
        session_type=session_type,
        rep_count=0,
        avg_form_score=0.0,
        prep_id=prep_id,
        keypoints_data={"snapshots": [{"ts": float(i), "score": 90, "kp": kp} for i, kp in enumerate(snaps_kp)]},
        started_at=started_at,
    )


# ── pure summarizer ───────────────────────────────────────────────────────────


def test_summarize_groups_by_pose_and_orders_chronologically() -> None:
    now = datetime.now(timezone.utc)
    fdb = _front_double_biceps()
    sessions = [
        _posing_session(sid="s2", uid="u", pose="front_double_biceps", snaps_kp=[fdb, fdb], started_at=now),
        _posing_session(
            sid="s1", uid="u", pose="front_double_biceps", snaps_kp=[fdb, fdb],
            started_at=now - timedelta(days=7),
        ),
    ]
    progress = summarize_posing_progress(sessions)
    assert len(progress) == 1
    trend = progress[0]
    assert trend.pose == "front_double_biceps"
    assert trend.label == "Front Double Biceps"
    # Oldest first so the chart reads left→right toward the show.
    assert [p.session_id for p in trend.points] == ["s1", "s2"]
    assert all(p.avg_score is not None for p in trend.points)
    assert all(p.symmetry is not None for p in trend.points)  # front pose → symmetry scored


def test_summarize_side_pose_has_no_symmetry() -> None:
    now = datetime.now(timezone.utc)
    side = _side_pose()
    sessions = [_posing_session(sid="s1", uid="u", pose="side_chest", snaps_kp=[side, side], started_at=now)]
    progress = summarize_posing_progress(sessions)
    assert len(progress) == 1
    assert all(p.symmetry is None for p in progress[0].points)


def test_summarize_single_snapshot_has_no_steadiness() -> None:
    now = datetime.now(timezone.utc)
    fdb = _front_double_biceps()
    sessions = [_posing_session(sid="s1", uid="u", pose="front_double_biceps", snaps_kp=[fdb], started_at=now)]
    progress = summarize_posing_progress(sessions)
    assert progress[0].points[0].steadiness is None  # <2 frames → unknown


def test_summarize_steadiness_drops_with_drift() -> None:
    now = datetime.now(timezone.utc)
    fdb = _front_double_biceps()
    steady = _posing_session(sid="a", uid="u", pose="front_double_biceps", snaps_kp=[fdb, fdb], started_at=now)
    shaky = _posing_session(
        sid="b", uid="u", pose="front_double_biceps",
        snaps_kp=[fdb, _jitter(fdb, 0.03)], started_at=now,
    )
    steady_val = summarize_posing_progress([steady])[0].points[0].steadiness
    shaky_val = summarize_posing_progress([shaky])[0].points[0].steadiness
    assert steady_val == 100.0  # identical frames → perfectly steady
    assert shaky_val is not None and shaky_val < steady_val


def test_summarize_ignores_non_posing_sessions() -> None:
    now = datetime.now(timezone.utc)
    fdb = _front_double_biceps()
    sessions = [
        _posing_session(sid="ex", uid="u", pose="squat", snaps_kp=[fdb, fdb], started_at=now, session_type="exercise"),
    ]
    assert summarize_posing_progress(sessions) == []


def test_summarize_is_deterministic() -> None:
    now = datetime.now(timezone.utc)
    fdb = _front_double_biceps()
    sessions = [_posing_session(sid="s1", uid="u", pose="front_double_biceps", snaps_kp=[fdb, fdb], started_at=now)]
    assert summarize_posing_progress(sessions) == summarize_posing_progress(sessions)


# ── endpoint ────────────────────────────────────────────────────────────────


async def _register(client: AsyncClient, email: str) -> str:
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["id"]


@pytest_asyncio.fixture
async def prep_with_rehearsals(client: AsyncClient, test_db: AsyncSession) -> tuple[str, str]:
    """Register a user, create a prep with a show date, and tag two rehearsals."""
    uid = await _register(client, "prepprogress@x.com")
    show = date.today() + timedelta(weeks=8)
    prep = PrepCycle(id="prep-1", user_id=uid, name="Nationals", show_date=show)
    test_db.add(prep)
    fdb = _front_double_biceps()
    base = datetime.now(timezone.utc)
    test_db.add_all(
        [
            _posing_session(
                sid="r1", uid=uid, pose="front_double_biceps", snaps_kp=[fdb, fdb],
                started_at=base - timedelta(days=14), prep_id="prep-1",
            ),
            _posing_session(
                sid="r2", uid=uid, pose="front_double_biceps", snaps_kp=[fdb, _jitter(fdb, 0.01)],
                started_at=base, prep_id="prep-1",
            ),
        ]
    )
    await test_db.commit()
    return uid, "prep-1"


async def test_prep_progress_returns_per_pose_trend(
    client: AsyncClient, prep_with_rehearsals: tuple[str, str]
) -> None:
    _, prep_id = prep_with_rehearsals
    resp = await client.get(f"/api/v1/history/preps/{prep_id}/progress")
    assert resp.status_code == 200
    body = resp.json()
    assert body["prep_id"] == prep_id
    assert body["name"] == "Nationals"
    assert len(body["poses"]) == 1

    trend = body["poses"][0]
    assert trend["pose"] == "front_double_biceps"
    assert len(trend["points"]) == 2
    p0, p1 = trend["points"]
    # Weeks-out counts down as the show approaches.
    assert p0["weeks_out"] > p1["weeks_out"]
    assert p0["avg_score"] is not None and p0["symmetry"] is not None


async def test_prep_progress_empty_prep_returns_no_poses(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    uid = await _register(client, "emptyprep@x.com")
    test_db.add(PrepCycle(id="prep-empty", user_id=uid, name="Off-season"))
    await test_db.commit()
    resp = await client.get("/api/v1/history/preps/prep-empty/progress")
    assert resp.status_code == 200
    assert resp.json()["poses"] == []


async def test_prep_progress_other_users_prep_returns_404(
    client: AsyncClient, test_db: AsyncSession
) -> None:
    await _register(client, "caller@x.com")
    other = User(email="rival@x.com", hashed_password="x")
    test_db.add(other)
    await test_db.flush()
    test_db.add(PrepCycle(id="prep-other", user_id=other.id, name="Secret"))
    await test_db.commit()
    resp = await client.get("/api/v1/history/preps/prep-other/progress")
    assert resp.status_code == 404  # IDOR — 404 not 403 to avoid leaking existence


async def test_prep_progress_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/history/preps/whatever/progress")
    assert resp.status_code == 401


@pytest.mark.parametrize("missing", ["nope", "prep-xyz"])
async def test_prep_progress_unknown_prep_returns_404(
    client: AsyncClient, prep_with_rehearsals: tuple[str, str], missing: str
) -> None:
    resp = await client.get(f"/api/v1/history/preps/{missing}/progress")
    assert resp.status_code == 404
