"""Fault-id taxonomy for the P29 voice coach.

Fault ids are MINTED by P29 — they are NOT identifiers emitted by
``app/analysis/**``. Those scorers emit only free-text cue sentences and a
handful of result-level ``status`` strings; there is no stable per-fault key
anywhere in the frozen analysis code (verified by reading
``app/analysis/form_scorer.py``, ``posing_scorer.py`` and
``exercise_verifier.py`` — see the P29 investigation report preceding S1).

This module derives the P29-owned mapping *mechanically* from
``app.analysis.form_scorer._CUES`` (a read-only import — this package is
never imported BY app/analysis, and app/analysis is never modified by it) so
the mapping cannot silently drift from the scorer copy it describes. If the
scorer's cues ever change shape, ``_movement_faults()`` raises instead of
guessing.

Fault id format
----------------
Movement faults: ``{exercise}.{joint_base}.{direction}``
    ``joint_base`` is the scored joint name with any ``left_``/``right_``
    prefix stripped (S1 amendment B). ``_CUES`` gives both sides identical
    cue text for every joint in the six-exercise scope (verified below at
    import time), so the spoken line is authored once per
    (exercise, joint_base, direction) and expanded to a clip per side at
    clip-generation time (S2) — never duplicated in ``lines.yaml``.
    ``direction`` is ``"low"`` or ``"high"``, exactly the direction key
    ``_CUES`` itself uses (below vs. above the healthy angle band).

Status faults: the bare ``STATUS_*`` value (``"mismatch"``,
    ``"insufficient_confidence"``, ``"wrong_orientation"``) — no exercise, no
    side.

Severity is deliberately NOT part of a fault id. Per S1 amendments 3/4,
severity is computed client-side from the joint-score deficit and only gates
whether/which cue fires; it never selects which audio clip plays. Clip key =
``{persona}.{fault_id}``.
"""

from __future__ import annotations

from dataclasses import dataclass

# Read-only import of the frozen scorer's cue table. app/analysis is never
# modified by this package (P29 guardrail) — this line only *reads* it.
from app.analysis.form_scorer import _CUES  # noqa: PLC2701 (private import intentional, see module docstring)

# The six exercises S1 covers. `bench`, `front_raise` and `overhead_triceps`
# are named directly in the P29 spec §6; `squat`, `deadlift`, `curl` were
# confirmed as "the three Fit3D-native exercises used in the thesis
# evaluation" in the pre-S1 clarification — the remaining members of
# form_scorer's "Original 7" once `bench` (already named separately) and
# `plank` (not Fit3D-sourced — see _PLANK_RANGES, a hardcoded alignment
# band, not an angle_ranges.json lookup) are excluded.
SCOPED_EXERCISES: tuple[str, ...] = (
    "bench",
    "front_raise",
    "overhead_triceps",
    "squat",
    "deadlift",
    "curl",
)

# Status faults and which WS mode(s) they can appear on (S1 amendment A).
# Sourced from the STATUS_* constants in app.analysis.form_scorer (coach-mode
# WS stream, `mode == "exercise"`) and app.analysis.posing_scorer
# (posing-mode stream, `mode == "posing"`). `insufficient_confidence` is
# defined independently in both modules with the same string value and is
# sent verbatim as the WS `status` field from both branches of
# app/api/v1/ws_inference.py (read-only verified) — so it carries both
# modes, unlike `mismatch` (coach-only, from the exercise-verifier gate) and
# `wrong_orientation` (posing-only, from the orientation gate).
STATUS_FAULT_MODES: dict[str, tuple[str, ...]] = {
    "mismatch": ("coach",),
    "insufficient_confidence": ("coach", "posing"),
    "wrong_orientation": ("posing",),
}


def _joint_base(joint: str) -> tuple[str, tuple[str, ...]]:
    """Split a scored joint name into (base, sides).

    Returns an empty ``sides`` tuple for a centre joint (no left_/right_
    prefix) — none exist among the six scoped exercises today (verified
    below), but the split stays correct if that ever changes.
    """
    if joint.startswith("left_"):
        return joint[len("left_") :], ("left",)
    if joint.startswith("right_"):
        return joint[len("right_") :], ("right",)
    return joint, ()


@dataclass(frozen=True)
class MovementFault:
    """One P29-minted movement fault template."""

    fault_id: str  # "{exercise}.{joint_base}.{direction}"
    exercise: str
    joint_base: str
    direction: str  # "low" | "high"
    sides: tuple[str, ...]  # ("left", "right") for every joint in scope today
    cue_text: str  # the exact sentence app/analysis emits, either side


def _movement_faults() -> list[MovementFault]:
    """Derive the movement fault list from `_CUES`, scoped to SCOPED_EXERCISES.

    Raises ``ValueError`` rather than guessing if a joint's left/right cue
    text ever diverges — the side-agnostic templating in `lines.yaml`
    (S1 amendment B) assumes it never does.
    """
    faults: list[MovementFault] = []
    for exercise in SCOPED_EXERCISES:
        joint_cues = _CUES[exercise]
        bases: dict[str, dict[str, set[str]]] = {}
        for joint, directions in joint_cues.items():
            base, sides = _joint_base(joint)
            entry = bases.setdefault(base, {"sides": set(), "low": set(), "high": set()})
            entry["sides"].update(sides)
            entry["low"].add(directions["low"])
            entry["high"].add(directions["high"])
        for base, info in sorted(bases.items()):
            for direction in ("low", "high"):
                texts = info[direction]
                if len(texts) != 1:
                    raise ValueError(
                        f"{exercise}.{base}.{direction}: left/right cue text differs "
                        f"({texts!r}) — side-agnostic templating (S1 amendment B) "
                        "assumes identical text across sides."
                    )
                faults.append(
                    MovementFault(
                        fault_id=f"{exercise}.{base}.{direction}",
                        exercise=exercise,
                        joint_base=base,
                        direction=direction,
                        sides=tuple(sorted(info["sides"])),
                        cue_text=next(iter(texts)),
                    )
                )
    return faults


MOVEMENT_FAULTS: tuple[MovementFault, ...] = tuple(_movement_faults())
MOVEMENT_FAULT_IDS: tuple[str, ...] = tuple(f.fault_id for f in MOVEMENT_FAULTS)
STATUS_FAULT_IDS: tuple[str, ...] = tuple(STATUS_FAULT_MODES)
ALL_FAULT_IDS: tuple[str, ...] = MOVEMENT_FAULT_IDS + STATUS_FAULT_IDS


def cue_text_lookup() -> dict[tuple[str, str], str]:
    """Build the (exercise, cue_text) -> fault_id lookup table (S1 amendment 2).

    The WS frame carries the cue *sentence*, not a key, so the runtime
    arbiter resolves an incoming cue by exact string match against this
    table, scoped to the WS session's already-known active exercise —
    cue text alone is ambiguous *across* exercises (a few sentences repeat
    verbatim, e.g. "Tuck elbows closer in" is both
    ``bench.shoulder_angle.low`` and ``overhead_triceps.shoulder_angle.high``)
    but never *within* one exercise (enforced below).

    The resolved fault id is the side-agnostic template id — resolving the
    *side* (to reach a full per-side clip) is a separate runtime step using
    the WS frame's ``worst_joint`` field, not this table.
    """
    table: dict[tuple[str, str], str] = {}
    for fault in MOVEMENT_FAULTS:
        key = (fault.exercise, fault.cue_text)
        if key in table:
            raise ValueError(f"cue text collision within one exercise: {key!r}")
        table[key] = fault.fault_id
    return table


CUE_TEXT_LOOKUP: dict[tuple[str, str], str] = cue_text_lookup()
