"""Loader for ``data/voice/voice_ids.yaml`` — the (provider, persona) -> voice
id mapping. See that file's header and ``app/voice/personas.py``'s docstring
for why this lives in config rather than as a field on ``Persona``.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, RootModel

from app.voice.personas import PersonaKey

DEFAULT_VOICE_IDS_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "voice" / "voice_ids.yaml"

_PLACEHOLDER_PREFIX = "TBD_"


def is_placeholder(voice_id: str) -> bool:
    """True for an unfilled voice id (e.g. the ElevenLabs entries in
    ``data/voice/voice_ids.yaml`` until real voice ids are chosen)."""
    return voice_id.startswith(_PLACEHOLDER_PREFIX)


class ProviderVoiceIds(RootModel[dict[PersonaKey, str]]):
    """Persona -> voice id mapping for one provider."""


class VoiceIdsFile(BaseModel):
    """Top-level shape of ``data/voice/voice_ids.yaml``: provider id -> mapping."""

    providers: dict[str, ProviderVoiceIds]

    def resolve(self, provider_id: str, persona: PersonaKey) -> str:
        """Look up the voice id for one (provider, persona) pair.

        Raises ``KeyError`` for a genuinely missing entry (unknown provider
        or persona) — that is always a config error. A *placeholder* value
        (``is_placeholder(...)`` is True) is returned as-is rather than
        raised here: it's still a valid string to plan and hash against
        (needed for ``--dry-run`` to work against an unconfigured provider),
        it's only invalid to actually synthesize against. Callers that are
        about to call a provider's ``synth`` must check
        ``is_placeholder()`` themselves first — see
        ``scripts/gen_voice_clips.py``'s ``main()``.
        """
        provider_map = self.providers.get(provider_id)
        if provider_map is None:
            raise KeyError(f"no voice ids configured for provider {provider_id!r} in {DEFAULT_VOICE_IDS_PATH}")
        voice_id = provider_map.root.get(persona)
        if voice_id is None:
            raise KeyError(f"no voice id configured for persona {persona!r} under provider {provider_id!r}")
        return voice_id


def load_voice_ids(path: Path = DEFAULT_VOICE_IDS_PATH) -> VoiceIdsFile:
    with path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return VoiceIdsFile.model_validate({"providers": raw})
