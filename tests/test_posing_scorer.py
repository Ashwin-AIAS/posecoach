"""Posing scorer (P15/P16/P17) — pose-match, symmetry, hold, divisions, turns."""

from __future__ import annotations

import numpy as np
import pytest

from app.analysis.posing_scorer import (
    STATUS_INSUFFICIENT_CONFIDENCE,
    STATUS_OK,
    STATUS_UNKNOWN_POSE,
    STATUS_WRONG_ORIENTATION,
    SUPPORTED_DIVISIONS,
    SUPPORTED_POSES,
    HoldTracker,
    PoseScore,
    QuarterTurnVerifier,
    division_label,
    division_poses,
    pose_label,
    pose_orientation,
    pose_template,
    score_pose,
    supported_divisions,
    supported_poses,
)

# COCO indices for the synthetic skeletons.
_NOSE, _LEYE, _REYE = 0, 1, 2
_LEAR, _REAR = 3, 4
_LSH, _RSH = 5, 6
_LEL, _REL = 7, 8
_LWR, _RWR = 9, 10
_LHIP, _RHIP = 11, 12
_LKNE, _RKNE = 13, 14
_LANK, _RANK = 15, 16


def _front_double_biceps() -> tuple[np.ndarray, np.ndarray]:
    """Front-facing double-biceps-ish skeleton: scores well, fully symmetric."""
    kp = np.zeros((17, 2), dtype=float)
    kp[_NOSE] = (0.50, 0.12)
    kp[_LEYE] = (0.53, 0.10)
    kp[_REYE] = (0.47, 0.10)
    kp[_LEAR] = (0.56, 0.11)
    kp[_REAR] = (0.44, 0.11)
    kp[_LSH] = (0.62, 0.27)
    kp[_RSH] = (0.38, 0.27)
    kp[_LEL] = (0.72, 0.20)
    kp[_REL] = (0.28, 0.20)
    kp[_LWR] = (0.68, 0.10)
    kp[_RWR] = (0.32, 0.10)
    kp[_LHIP] = (0.57, 0.55)
    kp[_RHIP] = (0.43, 0.55)
    kp[_LKNE] = (0.585, 0.78)
    kp[_RKNE] = (0.415, 0.78)
    kp[_LANK] = (0.61, 0.98)
    kp[_RANK] = (0.39, 0.98)
    return kp, np.ones(17, dtype=float)


def _rear_double_biceps() -> tuple[np.ndarray, np.ndarray]:
    """Rear-facing double biceps: shoulder x-order flips, face hidden."""
    kp, conf = _front_double_biceps()
    for left, right in ((_LSH, _RSH), (_LEL, _REL), (_LWR, _RWR), (_LHIP, _RHIP), (_LKNE, _RKNE), (_LANK, _RANK)):
        kp[left, 0], kp[right, 0] = kp[right, 0], kp[left, 0]
    conf[_NOSE] = conf[_LEYE] = conf[_REYE] = 0.05
    return kp, conf


def _front_lat_spread() -> tuple[np.ndarray, np.ndarray]:
    """Front lat spread: arms out near-horizontal, elbows ~straight at shoulder line."""
    kp, conf = _front_double_biceps()
    # Arms extended to the sides, roughly parallel to the ground.
    kp[_LEL] = (0.78, 0.28)
    kp[_REL] = (0.22, 0.28)
    kp[_LWR] = (0.92, 0.29)
    kp[_RWR] = (0.08, 0.29)
    return kp, conf


def _side_pose() -> tuple[np.ndarray, np.ndarray]:
    """Profile skeleton: shoulders collapse onto one x, front knee bent, heel raised."""
    kp = np.zeros((17, 2), dtype=float)
    kp[_NOSE] = (0.48, 0.12)
    kp[_LEYE] = (0.47, 0.10)
    kp[_REYE] = (0.49, 0.10)
    kp[_LSH] = (0.50, 0.30)
    kp[_RSH] = (0.47, 0.30)
    kp[_LEL] = (0.52, 0.42)
    kp[_REL] = (0.49, 0.42)
    kp[_LWR] = (0.53, 0.52)
    kp[_RWR] = (0.50, 0.52)
    kp[_LHIP] = (0.50, 0.55)
    kp[_RHIP] = (0.48, 0.55)
    kp[_LKNE] = (0.58, 0.72)  # front (bent) leg
    kp[_RKNE] = (0.47, 0.78)  # back (straight) leg
    kp[_LANK] = (0.53, 0.92)  # front heel raised → higher than the back ankle
    kp[_RANK] = (0.47, 1.00)
    return kp, np.ones(17, dtype=float)


def _skeleton_for(pose: str) -> tuple[np.ndarray, np.ndarray]:
    """Pick an orientation-appropriate skeleton so any pose computes ≥1 check."""
    orient = pose_orientation(pose)
    if orient == "rear":
        return _rear_double_biceps()
    if orient == "side":
        return _side_pose()
    return _front_double_biceps()


# ── Tailored "perfect" skeletons proving each P17 template actually scores well ──


def _mp_front() -> tuple[np.ndarray, np.ndarray]:
    """Men's Physique front: arms relaxed at the sides, feet ~hip width."""
    kp, conf = _front_double_biceps()
    kp[_LEL] = (0.64, 0.42)
    kp[_REL] = (0.36, 0.42)
    kp[_LWR] = (0.65, 0.55)
    kp[_RWR] = (0.35, 0.55)
    return kp, conf


def _figure_front() -> tuple[np.ndarray, np.ndarray]:
    """Figure front: hands on hips."""
    kp, conf = _front_double_biceps()
    kp[_LEL] = (0.66, 0.45)
    kp[_REL] = (0.34, 0.45)
    kp[_LWR] = (0.56, 0.54)  # on left hip (0.57, 0.55)
    kp[_RWR] = (0.44, 0.54)  # on right hip (0.43, 0.55)
    return kp, conf


def _most_muscular() -> tuple[np.ndarray, np.ndarray]:
    """Most Muscular: fists together at centre, elbows forward/down."""
    kp, conf = _front_double_biceps()
    kp[_LEL] = (0.58, 0.38)
    kp[_REL] = (0.42, 0.38)
    kp[_LWR] = (0.51, 0.42)
    kp[_RWR] = (0.49, 0.42)
    return kp, conf


def _abdominal_and_thigh() -> tuple[np.ndarray, np.ndarray]:
    """Abdominal & Thigh: both hands behind the head (wrists near the ears)."""
    kp, conf = _front_double_biceps()
    kp[_LWR] = (0.57, 0.13)  # near left ear (0.56, 0.11)
    kp[_RWR] = (0.43, 0.13)  # near right ear (0.44, 0.11)
    return kp, conf


def _rear_lat_spread() -> tuple[np.ndarray, np.ndarray]:
    """Rear Lat Spread: hands at the waist, elbows flared, from behind."""
    kp, conf = _rear_double_biceps()
    kp[_LEL] = (0.30, 0.42)
    kp[_REL] = (0.70, 0.42)
    kp[_LWR] = (0.44, 0.54)  # near (mirrored) left hip (0.43, 0.55)
    kp[_RWR] = (0.56, 0.54)  # near (mirrored) right hip (0.57, 0.55)
    return kp, conf


# pose id → builder of a skeleton that should score that pose highly.
_GOOD_SKELETONS = {
    "front_double_biceps": _front_double_biceps,
    "front_lat_spread": _front_lat_spread,
    "rear_double_biceps": _rear_double_biceps,
    "side_chest": _side_pose,
    "most_muscular": _most_muscular,
    "abdominal_and_thigh": _abdominal_and_thigh,
    "rear_lat_spread": _rear_lat_spread,
    "mp_front": _mp_front,
    "figure_front": _figure_front,
}


@pytest.mark.parametrize("pose", sorted(SUPPORTED_POSES))
def test_score_pose_returns_pose_score(pose: str) -> None:
    kp, conf = _skeleton_for(pose)
    result = score_pose(pose, kp, conf)
    assert isinstance(result, PoseScore)
    assert result.status == STATUS_OK


@pytest.mark.parametrize("pose", sorted(SUPPORTED_POSES))
def test_score_in_valid_range(pose: str) -> None:
    kp, conf = _skeleton_for(pose)
    result = score_pose(pose, kp, conf)
    assert 0.0 <= result.score <= 100.0
    assert 0.0 <= result.symmetry_score <= 100.0
    assert 0.0 <= result.position_score <= 100.0


@pytest.mark.parametrize("pose", sorted(SUPPORTED_POSES))
def test_cues_are_short(pose: str) -> None:
    kp, conf = _skeleton_for(pose)
    result = score_pose(pose, kp, conf)
    for cue in result.cues:
        assert len(cue.split()) <= 8, f"{pose}: cue too long: '{cue}'"


@pytest.mark.parametrize("pose,builder", sorted(_GOOD_SKELETONS.items()))
def test_good_pose_scores_high(pose: str, builder) -> None:  # type: ignore[no-untyped-def]
    """A correctly-hit pose scores high — proves each template's ranges are sane."""
    kp, conf = builder()
    result = score_pose(pose, kp, conf)
    assert result.status == STATUS_OK
    assert result.score >= 70.0, f"{pose}: a good pose should score high, got {result.score}"


@pytest.mark.parametrize("pose", sorted(SUPPORTED_POSES))
def test_deterministic_same_input_same_output(pose: str) -> None:
    kp, conf = _skeleton_for(pose)
    r1 = score_pose(pose, kp, conf)
    r2 = score_pose(pose, kp, conf)
    assert r1.score == r2.score
    assert r1.cues == r2.cues
    assert r1.check_scores == r2.check_scores


@pytest.mark.parametrize("pose", sorted(SUPPORTED_POSES))
def test_score_variance_below_5pct(pose: str) -> None:
    """Thesis gate: 20 identical inputs → < 5% score variance."""
    kp, conf = _skeleton_for(pose)
    scores = [score_pose(pose, kp, conf).score for _ in range(20)]
    mean = float(np.mean(scores))
    std = float(np.std(scores))
    cv = (std / mean * 100.0) if mean > 0 else 0.0
    assert cv < 5.0, f"{pose}: variance {cv:.2f}% exceeds 5% (mean={mean:.1f})"


def test_unknown_pose_returns_unknown_status() -> None:
    kp, conf = _front_double_biceps()
    result = score_pose("not_a_real_pose", kp, conf)
    assert result.status == STATUS_UNKNOWN_POSE
    assert any("nknown" in c for c in result.cues)


def test_low_confidence_gives_insufficient_status() -> None:
    kp, _ = _front_double_biceps()
    conf = np.zeros(17, dtype=float)
    result = score_pose("front_double_biceps", kp, conf)
    assert result.status == STATUS_INSUFFICIENT_CONFIDENCE
    assert len(result.cues) > 0


def test_wrong_orientation_is_rejected() -> None:
    """A front pose attempted while facing away is flagged, not silently scored."""
    kp, conf = _rear_double_biceps()
    result = score_pose("front_double_biceps", kp, conf)
    assert result.status == STATUS_WRONG_ORIENTATION
    assert result.orientation_ok is False
    assert len(result.cues) > 0


def test_asymmetry_lowers_symmetry_score() -> None:
    """Raising one elbow far above the other must drop the symmetry sub-score."""
    sym_kp, sym_conf = _front_double_biceps()
    symmetric = score_pose("front_double_biceps", sym_kp, sym_conf)

    asym_kp, asym_conf = _front_double_biceps()
    asym_kp[_LEL] = (0.72, 0.05)  # left elbow much higher than right
    asym_kp[_LWR] = (0.68, 0.00)
    asymmetric = score_pose("front_double_biceps", asym_kp, asym_conf)

    assert asymmetric.symmetry_score < symmetric.symmetry_score


def test_side_pose_disables_symmetry() -> None:
    """P16: in profile, symmetry is neither scored nor cued (it's meaningless)."""
    kp, conf = _side_pose()
    result = score_pose("side_chest", kp, conf)
    assert result.status == STATUS_OK
    assert result.orientation == "side"
    assert result.symmetry_applicable is False
    # No symmetry pair is evaluated, so no symmetry cue can be emitted.
    symmetry_cues = {"Match both elbow angles", "Level your elbows evenly", "Square your shoulders evenly"}
    assert not (set(result.cues) & symmetry_cues)


def test_low_visibility_joints_are_skipped() -> None:
    """P16: joints below the 0.5 low-vis gate are excluded, not scored as garbage."""
    kp, conf = _front_double_biceps()
    # Drop the left arm below the gate (0.4 < 0.5); the right arm stays confident.
    conf[_LEL] = 0.4
    conf[_LWR] = 0.4
    result = score_pose("front_double_biceps", kp, conf)
    assert "left_elbow_angle" not in result.measured_params
    assert "left_forearm_vertical" not in result.measured_params
    assert "right_elbow_angle" in result.measured_params


def test_supported_poses_and_labels() -> None:
    for pose in ("front_double_biceps", "front_lat_spread", "rear_double_biceps", "side_chest", "side_triceps"):
        assert pose in SUPPORTED_POSES
    assert supported_poses() == sorted(SUPPORTED_POSES)
    assert pose_label("front_double_biceps") == "Front Double Biceps"
    assert pose_label("side_chest") == "Side Chest"
    assert pose_label("not_a_real_pose") is None


# ── P17: full division coverage ───────────────────────────────────────────────


def test_division_catalogue_is_complete() -> None:
    """Every required division is present, each with its mandatory lineup (P17)."""
    expected = {"open", "classic", "mens_physique", "bikini", "wellness", "figure", "womens_physique"}
    assert set(SUPPORTED_DIVISIONS) == expected
    assert supported_divisions() == sorted(SUPPORTED_DIVISIONS)
    # Men's Open Bodybuilding has its 8 mandatory poses.
    assert len(division_poses("open") or []) == 8
    for division in SUPPORTED_DIVISIONS:
        mandatories = division_poses(division)
        assert mandatories, f"{division}: no mandatories"
        assert division_label(division)
        for pose_id in mandatories:
            assert pose_id in SUPPORTED_POSES, f"{division} references missing pose {pose_id}"


def test_unknown_division_returns_none() -> None:
    assert division_poses("strongman") is None
    assert division_label("strongman") is None


def test_every_pose_template_is_well_formed() -> None:
    """Schema validation: every pose template has valid checks + symmetry pairs."""
    for pose_id in SUPPORTED_POSES:
        template = pose_template(pose_id)
        assert template is not None
        assert template["orientation"] in {"front", "rear", "side"}
        assert template["label"]
        assert template["checks"], f"{pose_id}: no checks"
        for check in template["checks"]:
            assert {"param", "lo", "hi", "margin", "cue_low", "cue_high"} <= set(check)
            assert check["lo"] <= check["hi"], f"{pose_id}: {check['param']} lo > hi"
            assert check["margin"] > 0
        for entry in template.get("symmetry", []):
            assert len(entry["params"]) == 2
            assert entry["tolerance"] > 0


# ── P17: quarter-turn verification ────────────────────────────────────────────


def test_quarter_turn_sequence_completes() -> None:
    """front → side → rear → side is confirmed in order by the classifier (P17)."""
    verifier = QuarterTurnVerifier()
    assert verifier.update(*_front_double_biceps()).step == 1
    assert verifier.update(*_side_pose()).step == 2
    assert verifier.update(*_rear_double_biceps()).step == 3
    final = verifier.update(*_side_pose())
    assert final.completed is True
    assert verifier.completed is True


def test_quarter_turn_ignores_out_of_order_frames() -> None:
    """A frame that isn't the expected next turn doesn't advance the rotation."""
    verifier = QuarterTurnVerifier()
    state = verifier.update(*_rear_double_biceps())  # expected front, got rear
    assert state.step == 0
    assert state.expected_next == "front"
    assert state.completed is False


def test_quarter_turn_reset_restarts() -> None:
    verifier = QuarterTurnVerifier()
    verifier.update(*_front_double_biceps())
    verifier.reset()
    assert verifier.completed is False
    state = verifier.update(*_side_pose())  # side is no longer expected after reset
    assert state.step == 0


def test_hold_tracker_accumulates_while_held() -> None:
    kp, conf = _front_double_biceps()
    tracker = HoldTracker()
    s0 = tracker.update(90.0, kp, conf, now=0.0)
    s1 = tracker.update(90.0, kp, conf, now=1.0)
    s2 = tracker.update(90.0, kp, conf, now=2.5)
    assert s0.seconds == 0.0
    assert s1.seconds == 1.0
    assert s2.seconds == 2.5
    # A perfectly still pose is steady once there is enough history.
    assert s2.steady is True
    assert s2.stability >= 70.0


def test_hold_tracker_resets_below_threshold() -> None:
    kp, conf = _front_double_biceps()
    tracker = HoldTracker()
    tracker.update(90.0, kp, conf, now=0.0)
    tracker.update(90.0, kp, conf, now=1.0)
    dropped = tracker.update(10.0, kp, conf, now=2.0)  # score collapses
    assert dropped.seconds == 0.0
    assert dropped.steady is False
    # Hold timer restarts from the next good frame.
    resumed = tracker.update(90.0, kp, conf, now=3.0)
    assert resumed.seconds == 0.0


def test_hold_tracker_jitter_lowers_stability() -> None:
    kp, conf = _front_double_biceps()
    steady = HoldTracker()
    shaky = HoldTracker()
    rng = np.random.default_rng(0)
    last_steady = last_shaky = None
    for i in range(10):
        t = float(i)
        last_steady = steady.update(90.0, kp, conf, now=t)
        jittered = kp + rng.uniform(-0.05, 0.05, kp.shape)
        last_shaky = shaky.update(90.0, jittered, conf, now=t)
    assert last_steady is not None and last_shaky is not None
    assert last_shaky.stability < last_steady.stability
