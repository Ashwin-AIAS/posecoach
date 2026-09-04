"""Clip plan for the P29 voice coach.

Bridges ``app.voice.fault_taxonomy`` (which side-agnostic fault *templates*
exist — the 22 movement + 3 status = 25 keys in ``data/voice/lines.yaml``,
per S1 amendment B) and ``app.voice.schemas`` (the authored lines) into the
flat, fully-expanded list of individual audio clips
``scripts/gen_voice_clips.py`` (S2) must synthesize.

"Expanded" means: a movement template (``sides == ("left", "right")``)
contributes two clip specs — one per side, with the literal ``{side}``
placeholder substituted in the text where a persona's line uses it — and a
status fault (``sides == ()``) contributes exactly one. That yields the
47-fault-id space (44 = 22 templates x 2 sides, + 3 status) agreed in the
pre-S1 clarification, and 47 x 3 personas = 141 total clips — the number
S1 amendment B fixed as unchanged: "only the authoring surface shrinks."
"""

from __future__ import annotations

from dataclasses import dataclass

from app.voice.personas import PERSONA_KEYS, PersonaKey
from app.voice.schemas import LinesFile

# Movement templates x 2 sides, plus status faults (no side) — the number
# every downstream consumer (S2's script, the coverage test, the eventual
# frontend arbiter) should treat as "the fault id count", not the 25-entry
# template count that lines.yaml itself is keyed by.
EXPANDED_FAULT_ID_COUNT = 47
TOTAL_CLIP_COUNT = EXPANDED_FAULT_ID_COUNT * len(PERSONA_KEYS)  # 141


def expanded_fault_id(template_id: str, side: str | None) -> str:
    """The per-side fault id a clip is actually keyed by.

    A movement template's id becomes ``"{template_id}.{side}"``; a status
    fault (``side=None``) is unchanged.
    """
    return template_id if side is None else f"{template_id}.{side}"


def expanded_fault_ids(lines: LinesFile) -> tuple[str, ...]:
    """Every fault id at clip granularity — see module docstring."""
    ids: list[str] = []
    for template_id, entry in lines.faults.items():
        sides: tuple[str, ...] = entry.sides if entry.sides else ()
        if sides:
            ids.extend(expanded_fault_id(template_id, side) for side in sides)
        else:
            ids.append(expanded_fault_id(template_id, None))
    return tuple(ids)


@dataclass(frozen=True)
class ClipSpec:
    """One clip to synthesize — exactly one (persona, expanded fault id) pair."""

    persona: PersonaKey
    template_id: str  # the lines.yaml key, e.g. "bench.elbow_angle.low" or "mismatch"
    side: str | None  # "left" | "right" | None (status faults / centre joints)
    fault_id: str  # expanded_fault_id(template_id, side)
    text: str  # {side} substituted if the line and side both call for it


def build_clip_plan(lines: LinesFile) -> list[ClipSpec]:
    """The full expanded-fault-id x persona clip plan (47 x 3 = 141)."""
    plan: list[ClipSpec] = []
    for template_id, entry in lines.faults.items():
        sides: tuple[str | None, ...] = entry.sides if entry.sides else (None,)
        for side in sides:
            fault_id = expanded_fault_id(template_id, side)
            for persona in PERSONA_KEYS:
                text = entry.lines[persona]
                if side is not None:
                    text = text.replace("{side}", side)
                plan.append(
                    ClipSpec(
                        persona=persona,
                        template_id=template_id,
                        side=side,
                        fault_id=fault_id,
                        text=text,
                    )
                )
    return plan
