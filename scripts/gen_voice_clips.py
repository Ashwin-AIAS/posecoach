"""Dev-time batch TTS clip generation for the P29 voice coach (S2).

Reads ``data/voice/lines.yaml`` (via ``app.voice.clip_plan``), synthesizes
one audio clip per (persona, expanded fault id) through a pluggable
``TTSProvider``, hash-caches so an unchanged clip costs nothing on re-run,
and writes ``frontend/public/voice/manifest.json`` + the mp3 files.

Usage::

    python scripts/gen_voice_clips.py --dry-run
    python scripts/gen_voice_clips.py --provider kokoro
    python scripts/gen_voice_clips.py --provider kokoro --persona atlas
    python scripts/gen_voice_clips.py --provider elevenlabs

Kokoro (default) is local, open-weight, free, no API key — first run
downloads the Kokoro-82M weights from Hugging Face Hub and caches them.
ElevenLabs is the documented fallback, gated behind ``ELEVENLABS_API_KEY``
in the environment (``.env``, gitignored — never hardcoded, never read at
runtime by the app). Neither provider is a runtime dependency: both live in
``requirements-voice.txt`` (dev-time only), never in ``requirements.txt`` or
``requirements-dev.txt``, and neither is imported unless actually selected
via ``--provider`` (lazy import inside each provider's ``synth``).

See ``docs/prompts/P29_VOICE_COACH_PERSONAS.md`` §6.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import structlog

from app.voice.clip_plan import ClipSpec, build_clip_plan
from app.voice.personas import PERSONA_KEYS, PersonaKey
from app.voice.schemas import load_lines_file
from app.voice.voice_ids import VoiceIdsFile, is_placeholder, load_voice_ids

logger = structlog.get_logger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "frontend" / "public" / "voice"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

# Speech is fine at this rate and it keeps preload fast (P29 spec §6).
TARGET_BITRATE_KBPS = 64
TARGET_CHANNELS = 1
KOKORO_SAMPLE_RATE = 24000
# How many "would synth" lines a --dry-run prints before summarizing the rest.
DRY_RUN_PREVIEW_LIMIT = 10


class TTSProvider(Protocol):
    """One synthesis backend. ``id`` is part of the clip hash (see
    ``clip_hash``), so switching providers invalidates the cache correctly.
    """

    id: str
    model_id: str

    def synth(self, text: str, voice_id: str) -> bytes:
        """Return encoded mono ~64kbps mp3 bytes for ``text``."""
        ...


@dataclass
class KokoroProvider:
    """Local, open-weight TTS (default) — zero cost, no API key, no
    watermark, no licensing footnote in the thesis (P29 spec §6).
    """

    id: str = "kokoro"
    model_id: str = "hexgrad/Kokoro-82M"
    lang_code: str = "a"  # American English
    _pipeline: object | None = field(default=None, init=False, repr=False)

    def _ensure_pipeline(self) -> object:
        if self._pipeline is None:
            # Dev-only dependency (requirements-voice.txt) — imported lazily
            # so --dry-run and the elevenlabs path never need it installed.
            from kokoro import KPipeline

            self._pipeline = KPipeline(lang_code=self.lang_code)
        return self._pipeline

    def synth(self, text: str, voice_id: str) -> bytes:
        import numpy as np
        import numpy.typing as npt

        pipeline = self._ensure_pipeline()
        chunks: list[npt.NDArray[np.float32]] = []
        for _graphemes, _phonemes, audio in pipeline(text, voice=voice_id):  # type: ignore[operator]
            arr = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
            chunks.append(arr)
        samples = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        return _encode_mp3_mono(samples, KOKORO_SAMPLE_RATE)


@dataclass
class ElevenLabsProvider:
    """Fallback provider (P29 spec §6) — only if a persona sounds flat on
    Kokoro. Requires ``ELEVENLABS_API_KEY`` in the environment; never
    hardcoded, never committed. Free tier: watermarked, no commercial usage
    rights — see the attribution obligations in the P29 spec §6/§12.
    """

    id: str = "elevenlabs"
    model_id: str = "eleven_turbo_v2_5"

    def synth(self, text: str, voice_id: str) -> bytes:
        import httpx

        api_key = os.environ.get("ELEVENLABS_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ELEVENLABS_API_KEY not set. Add it to .env (gitignored) — "
                "never hardcode it. See docs/prompts/P29_VOICE_COACH_PERSONAS.md §6."
            )
        resp = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": api_key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": self.model_id},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.content


PROVIDERS: dict[str, type[TTSProvider]] = {
    "kokoro": KokoroProvider,
    "elevenlabs": ElevenLabsProvider,
}


def _encode_mp3_mono(samples: object, sample_rate: int) -> bytes:
    """Encode float32 PCM samples to mono TARGET_BITRATE_KBPS mp3 via lameenc
    (pure-Python libmp3lame bindings — no system ffmpeg dependency)."""
    import lameenc
    import numpy as np

    arr = np.asarray(samples, dtype=np.float32)
    clipped = np.clip(arr, -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(TARGET_BITRATE_KBPS)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(TARGET_CHANNELS)
    encoder.set_quality(2)  # 2 = high quality (slower); fine for short clips
    mp3_bytes = encoder.encode(pcm16.tobytes())
    mp3_bytes += encoder.flush()
    return bytes(mp3_bytes)


def _mp3_duration_ms(mp3_bytes: bytes, bitrate_kbps: int) -> int:
    """Approximate CBR duration from byte size and bitrate.

    Good enough for a UI preload hint; not a precision requirement.
    """
    bits = len(mp3_bytes) * 8
    seconds = bits / (bitrate_kbps * 1000)
    return round(seconds * 1000)


def clip_hash(text: str, provider_id: str, voice_id: str, model_id: str) -> str:
    """sha256(text | provider_id | voice_id | model_id | settings)[:12].

    Any change to the line text, the provider, the voice, or the model
    invalidates the cache (P29 spec §6) — settings (bitrate/channels) are
    folded in too so an encoding-target change also invalidates correctly.
    """
    payload = "|".join(
        [text, provider_id, voice_id, model_id, f"{TARGET_BITRATE_KBPS}kbps", f"{TARGET_CHANNELS}ch"]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def clip_relpath(clip: ClipSpec) -> Path:
    return Path(clip.persona) / f"{clip.fault_id}.mp3"


def cue_key(clip: ClipSpec) -> str:
    """Clip key = {persona}.{fault_id} (S1 amendment 3 — no severity dimension)."""
    return f"{clip.persona}.{clip.fault_id}"


def load_manifest() -> dict[str, dict[str, object]]:
    if MANIFEST_PATH.exists():
        with MANIFEST_PATH.open(encoding="utf-8") as f:
            data: dict[str, dict[str, object]] = json.load(f)
            return data
    return {}


def save_manifest(manifest: dict[str, dict[str, object]]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")


@dataclass(frozen=True)
class PlannedClip:
    clip: ClipSpec
    voice_id: str
    hash: str
    relpath: Path


def plan_generation(
    clips: list[ClipSpec],
    provider: TTSProvider,
    manifest: dict[str, dict[str, object]],
    voice_ids: VoiceIdsFile | None = None,
) -> tuple[list[PlannedClip], int]:
    """Split ``clips`` into (needs synthesis, already-cached count).

    A clip is cached when the manifest's stored hash for its cue key
    matches the freshly computed hash AND the output file still exists on
    disk (so a manually deleted mp3 is regenerated even if the manifest
    wasn't touched). ``voice_ids`` defaults to the real
    ``data/voice/voice_ids.yaml``; tests inject a stand-in so they never
    depend on that file's real (provisional) contents.
    """
    if voice_ids is None:
        voice_ids = load_voice_ids()
    to_generate: list[PlannedClip] = []
    cached = 0
    for clip in clips:
        voice_id = voice_ids.resolve(provider.id, clip.persona)
        h = clip_hash(clip.text, provider.id, voice_id, provider.model_id)
        key = cue_key(clip)
        relpath = clip_relpath(clip)
        existing = manifest.get(key)
        out_path = OUTPUT_DIR / relpath
        if existing is not None and existing.get("hash") == h and out_path.exists():
            cached += 1
            continue
        to_generate.append(PlannedClip(clip=clip, voice_id=voice_id, hash=h, relpath=relpath))
    return to_generate, cached


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", choices=sorted(PROVIDERS), default="kokoro", help="TTS backend to use")
    parser.add_argument(
        "--persona", choices=sorted(PERSONA_KEYS), default=None, help="Regenerate only this persona"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the work plan and character count; synthesize nothing"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    lines = load_lines_file()
    plan: list[ClipSpec] = build_clip_plan(lines)
    if args.persona is not None:
        persona_key: PersonaKey = args.persona
        plan = [c for c in plan if c.persona == persona_key]

    provider: TTSProvider = PROVIDERS[args.provider]()
    manifest = load_manifest()
    to_generate, cached = plan_generation(plan, provider, manifest)
    total_chars = sum(len(pc.clip.text) for pc in to_generate)

    logger.info(
        "voice_clip_plan",
        provider=provider.id,
        total_clips=len(plan),
        cached=cached,
        to_generate=len(to_generate),
        total_chars_to_synth=total_chars,
        dry_run=args.dry_run,
    )
    print(
        f"provider={provider.id} total_clips={len(plan)} cached={cached} "
        f"to_generate={len(to_generate)} total_chars_to_synth={total_chars}"
    )

    if args.dry_run:
        print("--dry-run: no synthesis performed.")
        for planned in to_generate[:DRY_RUN_PREVIEW_LIMIT]:
            print(f"  would synth: {cue_key(planned.clip)} (voice={planned.voice_id}, hash={planned.hash})")
        if len(to_generate) > DRY_RUN_PREVIEW_LIMIT:
            print(f"  ... and {len(to_generate) - DRY_RUN_PREVIEW_LIMIT} more")
        return 0

    # Placeholder voice ids are fine to plan/hash against (dry-run above) but
    # must never reach a real synth() call — fail loudly here, before the
    # first API call, rather than mid-batch.
    placeholders = [planned for planned in to_generate if is_placeholder(planned.voice_id)]
    if placeholders:
        example = placeholders[0]
        print(
            f"error: {len(placeholders)} clip(s) have an unfilled voice id "
            f"(e.g. {cue_key(example.clip)} -> {example.voice_id!r}). "
            f"Fill in real voice ids for provider {provider.id!r} in data/voice/voice_ids.yaml first.",
            file=sys.stderr,
        )
        return 1

    for planned in to_generate:
        audio = provider.synth(planned.clip.text, planned.voice_id)
        out_path = OUTPUT_DIR / planned.relpath
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(audio)
        dur_ms = _mp3_duration_ms(audio, TARGET_BITRATE_KBPS)
        key = cue_key(planned.clip)
        manifest[key] = {"file": planned.relpath.as_posix(), "hash": planned.hash, "dur_ms": dur_ms}
        logger.info("voice_clip_generated", cue_key=key, dur_ms=dur_ms, bytes=len(audio))

    if to_generate:
        save_manifest(manifest)
    print(f"generated {len(to_generate)} clip(s); manifest at {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
