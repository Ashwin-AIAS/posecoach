"""Pydantic schemas for the P29 voice-coach data files.

Covers the on-disk shape of ``data/voice/lines.yaml`` (S1). Kept separate
from ``fault_taxonomy.py`` so the taxonomy module (a read-only derivation
from ``app.analysis``) stays free of any YAML/pydantic concerns, and this
module stays free of any ``app.analysis`` import.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator

from app.voice.personas import PERSONA_KEYS, PersonaKey

Direction = Literal["low", "high"]
Side = Literal["left", "right"]
Mode = Literal["coach", "posing"]

# lines.yaml lives at the repo root, two levels above this file
# (app/voice/schemas.py -> app/ -> repo root -> data/voice/lines.yaml).
DEFAULT_LINES_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "voice" / "lines.yaml"


class FaultLines(BaseModel):
    """One fault's authored copy — one line per persona.

    ``modes`` is a tuple rather than the single-mode field the spec sketch
    implied, because ``insufficient_confidence`` genuinely fires on both the
    coach and posing WS streams (verified in ``fault_taxonomy.py``) — a
    scalar field would have to misrepresent one of the three status faults.
    Every other fault carries exactly one mode.

    ``sides`` is empty for status faults and for any single-sided/centre
    joint (S1 amendment B) — none exist in the current six-exercise scope,
    but the shape stays correct if one is added later. Non-empty ``sides``
    means a line MAY contain a literal ``{side}`` placeholder, substituted
    at clip-generation time (S2); using it is a per-persona style choice,
    never a requirement — VECTOR's register calls for it, ATLAS/FORGE's
    generally don't (see the persona table in the P29 spec).
    """

    modes: tuple[Mode, ...] = Field(min_length=1)
    sides: tuple[Side, ...] = ()
    lines: dict[PersonaKey, str]

    @field_validator("lines")
    @classmethod
    def _all_personas_present_and_nonempty(cls, v: dict[PersonaKey, str]) -> dict[PersonaKey, str]:
        missing = set(PERSONA_KEYS) - set(v)
        if missing:
            raise ValueError(f"missing persona line(s): {sorted(missing)}")
        empty = [p for p, text in v.items() if not text.strip()]
        if empty:
            raise ValueError(f"empty line(s) for persona(s): {sorted(empty)}")
        return v

    @field_validator("sides")
    @classmethod
    def _sides_shape(cls, v: tuple[Side, ...]) -> tuple[Side, ...]:
        if v and set(v) != {"left", "right"}:
            raise ValueError(f"sides must be empty or exactly (left, right), got {v!r}")
        return v


class LinesFile(BaseModel):
    """Top-level shape of ``data/voice/lines.yaml``."""

    scope_exercises: tuple[str, ...]
    personas: tuple[PersonaKey, ...]
    faults: dict[str, FaultLines]

    @field_validator("personas")
    @classmethod
    def _personas_match_registry(cls, v: tuple[PersonaKey, ...]) -> tuple[PersonaKey, ...]:
        if set(v) != set(PERSONA_KEYS):
            raise ValueError(f"personas {v!r} must match the registry {PERSONA_KEYS!r} exactly")
        return v


def load_lines_file(path: Path = DEFAULT_LINES_PATH) -> LinesFile:
    """Load and validate ``lines.yaml`` from disk."""
    with path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return LinesFile.model_validate(raw)
