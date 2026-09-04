"""Persona registry for the P29 voice coach.

Three original coaching personas — ATLAS, FORGE, VECTOR — chosen for
contrasting registers (hype / mind-muscle / analytical), not for likeness to
any real or fictional person. See
``docs/prompts/P29_VOICE_COACH_PERSONAS.md`` §0 and §2 for the rationale and
the persona table this module implements.

Voice IDs are deliberately NOT modeled here — a single `voice_id: str` field
can't represent them correctly anyway, since Kokoro and ElevenLabs use
incompatible id schemes per provider. They live in
``data/voice/voice_ids.yaml`` (config, not code — see
``app/voice/voice_ids.py``), keyed by (provider, persona), so swapping voice
or provider is a config edit that never touches this module.
"""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel

PersonaKey = Literal["atlas", "forge", "vector"]

PERSONA_KEYS: tuple[PersonaKey, ...] = get_args(PersonaKey)


class Persona(BaseModel):
    """Static metadata for one coaching persona."""

    key: PersonaKey
    name: str
    # Named `tone`, not `register`, to avoid shadowing BaseModel's inherited
    # ABCMeta.register classmethod (pydantic warns on the collision).
    tone: str
    voice_texture: str
    # Shapes the RAG system-prompt tone only (S7) — never alters retrieved
    # facts or safety behaviour (P29 spec §7).
    prompt_fragment: str


PERSONAS: dict[PersonaKey, Persona] = {
    "atlas": Persona(
        key="atlas",
        name="ATLAS",
        tone="Loud, hype, celebratory. Short bursts.",
        voice_texture="deep/booming",
        prompt_fragment=(
            "Speak like ATLAS: loud, hype, celebratory, short bursts. Keep it "
            "to one or two sentences. Never invent facts or soften a safety "
            "warning to sound hype."
        ),
    ),
    "forge": Persona(
        key="forge",
        name="FORGE",
        tone="Slow, gravelly, mind-muscle. Cue-heavy.",
        voice_texture="gravelly/older",
        prompt_fragment=(
            "Speak like FORGE: slow, gravelly, mind-muscle focus, cue-heavy. "
            "Favor concrete technique cues over hype. Never invent facts."
        ),
    ),
    "vector": Persona(
        key="vector",
        name="VECTOR",
        tone="Clipped, deadpan, numeric. Reads state back.",
        voice_texture="flat/neutral",
        prompt_fragment=(
            "Speak like VECTOR: clipped, deadpan, numeric. Read back state "
            "plainly (joint, side, rep number) where relevant. Never invent "
            "facts or numbers not present in the retrieved context."
        ),
    ),
}
