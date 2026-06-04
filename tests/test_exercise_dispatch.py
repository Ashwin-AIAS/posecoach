"""P11 diagnostic harness — full scoring/rep pipeline per supported exercise.

This file is a *diagnostic*, not a unit test of one function. For each of the 7
core exercises it synthesises an anatomically-consistent stick-figure pose with
a controllable interior angle at each joint, drives a 60-frame rep oscillation,
and pushes every frame through the real pipeline:

    keypoints → compute_angles → score_exercise → RepCounter

It asserts (hard, per the P11 decision) that each exercise produces a
non-default score, a populated worst-joint, a cue on bad form, and — for the 6
dynamic lifts — a non-zero rep count. Failures point straight at the broken
stage. ``pytest tests/test_exercise_dispatch.py -v`` is the per-exercise report.

All synthetic input is full-confidence (1.0). A separate test feeds the same
geometry at sub-threshold confidence to reproduce the suspected *live* failure
(reps stuck at 0 / score collapsing to the default) deterministically.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
import pytest

from app.analysis.form_scorer import (
    STATUS_INSUFFICIENT_CONFIDENCE,
    STATUS_OK,
    FormResult,
    joint_range,
    score_exercise,
    worst_joint,
)
from app.analysis.keypoint_utils import (
    LEFT_ANKLE,
    LEFT_EAR,
    LEFT_ELBOW,
    LEFT_EYE,
    LEFT_HIP,
    LEFT_KNEE,
    LEFT_SHOULDER,
    LEFT_WRIST,
    NOSE,
    RIGHT_ANKLE,
    RIGHT_EAR,
    RIGHT_ELBOW,
    RIGHT_EYE,
    RIGHT_HIP,
    RIGHT_KNEE,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
    compute_angles,
)
from app.analysis.rep_counter import RepCounter

# The 7 core exercises this harness covers (the expanded set is exercised
# indirectly via the same code paths).
CORE_EXERCISES = ["squat", "deadlift", "curl", "bench", "ohp", "lunge", "plank"]
DYNAMIC_EXERCISES = [e for e in CORE_EXERCISES if e != "plank"]

# Which controllable interior angle defines one rep for each dynamic exercise.
_REP_PARAM: dict[str, str] = {
    "squat": "knee",
    "lunge": "knee",
    "deadlift": "hip",
    "curl": "elbow",
    "bench": "elbow",
    "ohp": "elbow",
}

# Map a controllable param to the (left-side) joint it scores against.
_PARAM_JOINT: dict[str, str] = {
    "knee": "left_knee_angle",
    "hip": "left_hip_angle",
    "elbow": "left_elbow_angle",
    "shoulder": "left_shoulder_angle",
}

# Neutral fallback angles for joints an exercise doesn't score (degrees).
_NEUTRAL = {"knee": 175.0, "hip": 170.0, "elbow": 160.0, "shoulder": 25.0}

_FRAMES = 60


def _unit(v: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _rotate(v: npt.NDArray[np.float64], deg: float) -> npt.NDArray[np.float64]:
    r = np.radians(deg)
    c, s = np.cos(r), np.sin(r)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1]], dtype=np.float64)


def _pose(*, knee: float, hip: float, elbow: float, shoulder: float) -> npt.NDArray[np.float64]:
    """Build a (17, 2) keypoint pose whose interior joint angles match the args.

    Image coordinates (y increases downward), normalised to roughly [0, 1].
    Each limb is constructed so the measured interior angle equals the requested
    value, letting the harness drive any single joint through a rep cycle.
    """
    kp = np.zeros((17, 2), dtype=np.float64)
    shoulder_mid = np.array([0.5, 0.30])
    hip_mid = np.array([0.5, 0.55])

    kp[LEFT_SHOULDER] = shoulder_mid + np.array([-0.12, 0.0])
    kp[RIGHT_SHOULDER] = shoulder_mid + np.array([0.12, 0.0])
    kp[LEFT_HIP] = hip_mid + np.array([-0.08, 0.0])
    kp[RIGHT_HIP] = hip_mid + np.array([0.08, 0.0])
    kp[NOSE] = shoulder_mid + np.array([0.0, -0.12])
    kp[LEFT_EYE] = kp[NOSE] + np.array([-0.02, -0.01])
    kp[RIGHT_EYE] = kp[NOSE] + np.array([0.02, -0.01])
    kp[LEFT_EAR] = kp[NOSE] + np.array([-0.04, 0.0])
    kp[RIGHT_EAR] = kp[NOSE] + np.array([0.04, 0.0])

    l_thigh, l_shin, l_uarm, l_farm = 0.20, 0.20, 0.15, 0.15

    for hip_idx, knee_idx, ankle_idx, sh_idx, side in (
        (LEFT_HIP, LEFT_KNEE, LEFT_ANKLE, LEFT_SHOULDER, -1.0),
        (RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE, RIGHT_SHOULDER, 1.0),
    ):
        h, sh = kp[hip_idx], kp[sh_idx]
        u = _unit(sh - h)  # hip → shoulder (up); interior hip angle is measured from here
        thigh_dir = _rotate(u, side * hip)
        knee_pt = h + l_thigh * thigh_dir
        w = _unit(h - knee_pt)  # knee → hip
        shin_dir = _rotate(w, -side * knee)
        kp[knee_idx] = knee_pt
        kp[ankle_idx] = knee_pt + l_shin * shin_dir

    for sh_idx, el_idx, wr_idx, hip_idx, side in (
        (LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST, LEFT_HIP, -1.0),
        (RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST, RIGHT_HIP, 1.0),
    ):
        sh, h = kp[sh_idx], kp[hip_idx]
        u = _unit(h - sh)  # shoulder → hip (down)
        uarm_dir = _rotate(u, side * shoulder)
        elbow_pt = sh + l_uarm * uarm_dir
        w = _unit(sh - elbow_pt)  # elbow → shoulder
        farm_dir = _rotate(w, side * elbow)
        kp[el_idx] = elbow_pt
        kp[wr_idx] = elbow_pt + l_farm * farm_dir

    return kp


def _full_conf() -> npt.NDArray[np.float64]:
    return np.ones(17, dtype=np.float64)


def _base_params(exercise: str) -> dict[str, float]:
    """Neutral angles, with each scored joint pinned to its range midpoint."""
    params = dict(_NEUTRAL)
    for param, joint in _PARAM_JOINT.items():
        rng = joint_range(exercise, joint)
        if rng is not None:
            params[param] = (rng[0] + rng[1]) / 2.0
    return params


def _good_frame(exercise: str) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """A pose where every scored joint sits inside its range (≈ perfect form)."""
    return _pose(**_base_params(exercise)), _full_conf()  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# Stage 1 — scoring produces a real, non-default result                        #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("exercise", CORE_EXERCISES)
def test_scoring_returns_nondefault_result(exercise: str) -> None:
    kp, conf = _good_frame(exercise)
    form: FormResult = score_exercise(exercise, kp, conf)

    # The silent-default path returns score=0.0 with an empty joint breakdown.
    assert form.joint_scores, f"{exercise}: no joint scores — hit the silent default path"
    assert form.score > 0.0, f"{exercise}: score collapsed to default 0.0"
    assert worst_joint(form.joint_scores) is not None, f"{exercise}: worst_joint not populated"
    assert form.measured_angles, f"{exercise}: no measured angles returned"


# --------------------------------------------------------------------------- #
# Stage 2 — bad form yields at least one coaching cue                          #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("exercise", CORE_EXERCISES)
def test_bad_form_produces_cue(exercise: str) -> None:
    params = _base_params(exercise)
    # Drive the exercise's primary joint far below its range to force a deviation.
    rep_param = _REP_PARAM.get(exercise, "hip")
    target_joint = _PARAM_JOINT[rep_param]
    rng = joint_range(exercise, target_joint)
    assert rng is not None, f"{exercise}: no range for {target_joint}"
    params[rep_param] = max(rng[0] - 40.0, 5.0)

    kp = _pose(**params)  # type: ignore[arg-type]
    form = score_exercise(exercise, kp, _full_conf())
    assert form.cues, f"{exercise}: deviated form produced no cue"


# --------------------------------------------------------------------------- #
# Stage 3 — rep counting over a streamed 60-frame oscillation                  #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("exercise", DYNAMIC_EXERCISES)
def test_dynamic_exercise_counts_reps(exercise: str) -> None:
    counter = RepCounter(exercise)
    assert counter.down_thr is not None and counter.up_thr is not None, f"{exercise}: no rep thresholds derived"

    rep_param = _REP_PARAM[exercise]
    params = _base_params(exercise)
    top = counter.up_thr + 3.0
    bottom = counter.down_thr - 3.0

    final = 0
    for i in range(_FRAMES):
        params[rep_param] = top if i % 2 == 0 else bottom
        kp = _pose(**params)  # type: ignore[arg-type]
        final = counter.update(compute_angles(kp, _full_conf()))

    assert final > 0, f"{exercise}: rep count stuck at 0 over {_FRAMES} streamed frames"


def test_plank_reports_zero_reps() -> None:
    counter = RepCounter("plank")
    assert counter.down_thr is None, "plank should be isometric (no rep thresholds)"

    kp, conf = _good_frame("plank")
    final = 0
    for _ in range(_FRAMES):
        final = counter.update(compute_angles(kp, conf))
    assert final == 0, "plank must not accumulate reps"


# --------------------------------------------------------------------------- #
# Stage 4 — reproduce the suspected LIVE failure deterministically             #
# --------------------------------------------------------------------------- #
def test_low_confidence_reproduces_live_failure() -> None:
    """Sub-threshold confidence ⇒ all angles None ⇒ insufficient_confidence, reps stay 0.

    This is the mechanism behind the in-gym symptoms: webcam keypoints can land
    below the angle-confidence gate even though the model ran fine, so every joint
    angle becomes None. Scoring then reports ``insufficient_confidence`` (no longer
    a silent 0.0) and the rep counter never sees an angle to cross a threshold.
    Confidence 0.2 sits below the lowered ANGLE_CONF_THRESHOLD (0.25 default), so
    this remains a genuine "can't measure you" frame.
    """
    kp, _ = _good_frame("squat")
    low_conf = np.full(17, 0.2, dtype=np.float64)  # below ANGLE_CONF_THRESHOLD (0.25)

    form = score_exercise("squat", kp, low_conf)
    assert form.status == STATUS_INSUFFICIENT_CONFIDENCE, "expected insufficient_confidence status"
    assert not form.joint_scores, "expected no joint scores under low confidence"

    counter = RepCounter("squat")
    final = 0
    for _ in range(_FRAMES):
        final = counter.update(compute_angles(kp, low_conf))
    assert final == 0, "expected zero reps when every tracked angle is None"


def test_mid_confidence_advances_reps_and_scores() -> None:
    """Webcam-band confidence (above the gate) must score and count reps.

    The P12/P13 regression guard for the conf-gate fix. Keypoints in the
    0.25–0.50 band — exactly where real webcam joints land — were discarded by the
    old 0.5 gate, collapsing scores to the silent default and freezing the rep
    counter. With the lowered, env-tunable ANGLE_CONF_THRESHOLD they are kept, so
    the same oscillation that fails at 0.2 now scores (status ok) and counts reps.
    """
    exercise = "squat"
    mid_conf = np.full(17, 0.35, dtype=np.float64)  # in the 0.25–0.50 webcam band

    counter = RepCounter(exercise)
    assert counter.down_thr is not None and counter.up_thr is not None
    rep_param = _REP_PARAM[exercise]
    params = _base_params(exercise)
    top = counter.up_thr + 3.0
    bottom = counter.down_thr - 3.0

    final = 0
    scored_ok = False
    for i in range(_FRAMES):
        params[rep_param] = top if i % 2 == 0 else bottom
        kp = _pose(**params)  # type: ignore[arg-type]
        form = score_exercise(exercise, kp, mid_conf)
        if form.status == STATUS_OK:
            scored_ok = True
            assert form.joint_scores, "mid-confidence frame produced no joint scores"
        final = counter.update(compute_angles(kp, mid_conf))

    assert scored_ok, "mid-confidence frames never scored — angle gate still too high"
    assert final > 0, "reps stuck at 0 for mid-confidence input — P12 regression"
