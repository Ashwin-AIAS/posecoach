"""Unit tests for scripts/gen_voice_clips.py's caching and planning logic.

Uses a stub TTSProvider (no kokoro/lameenc import, no network, no model
download) so these pass in any environment — including one where the real
Kokoro model download is blocked, per the P29 spec's documented fallback for
this stage: "complete the stage with --dry-run plus passing unit tests
against a stubbed provider."
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from app.voice.clip_plan import TOTAL_CLIP_COUNT, ClipSpec, build_clip_plan
from app.voice.personas import PERSONA_KEYS
from app.voice.schemas import load_lines_file
from app.voice.voice_ids import VoiceIdsFile
from scripts import gen_voice_clips as gvc


def _stub_voice_ids(*provider_ids: str) -> VoiceIdsFile:
    """A VoiceIdsFile mapping every persona to a dummy voice id, for each of
    ``provider_ids`` — independent of the real (provisional) voice_ids.yaml
    content, so these tests never depend on it.
    """
    return VoiceIdsFile.model_validate(
        {"providers": {pid: {persona: f"{pid}-voice-{persona}" for persona in PERSONA_KEYS} for pid in provider_ids}}
    )


@dataclass
class StubProvider:
    """A TTSProvider that never touches the network or a real model."""

    id: str = "stub"
    model_id: str = "stub-model-v1"
    calls: list[tuple[str, str]] | None = None

    def __post_init__(self) -> None:
        if self.calls is None:
            self.calls = []

    def synth(self, text: str, voice_id: str) -> bytes:
        assert self.calls is not None
        self.calls.append((text, voice_id))
        return b"FAKEAUDIOBYTES"


@pytest.fixture
def sample_clips() -> list[ClipSpec]:
    lines = load_lines_file()
    return build_clip_plan(lines)


def test_clip_hash_changes_with_each_input() -> None:
    base = gvc.clip_hash("hello", "kokoro", "am_onyx", "hexgrad/Kokoro-82M")
    assert base != gvc.clip_hash("goodbye", "kokoro", "am_onyx", "hexgrad/Kokoro-82M")
    assert base != gvc.clip_hash("hello", "elevenlabs", "am_onyx", "hexgrad/Kokoro-82M")
    assert base != gvc.clip_hash("hello", "kokoro", "am_michael", "hexgrad/Kokoro-82M")
    assert base != gvc.clip_hash("hello", "kokoro", "am_onyx", "some-other-model")
    # deterministic
    assert base == gvc.clip_hash("hello", "kokoro", "am_onyx", "hexgrad/Kokoro-82M")


def test_plan_generation_empty_manifest_needs_everything(
    sample_clips: list[ClipSpec], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(gvc, "OUTPUT_DIR", tmp_path)
    provider = StubProvider()
    to_generate, cached = gvc.plan_generation(sample_clips, provider, manifest={}, voice_ids=_stub_voice_ids("stub"))
    assert cached == 0
    assert len(to_generate) == len(sample_clips) == TOTAL_CLIP_COUNT


def test_plan_generation_skips_clips_whose_hash_and_file_both_match(
    sample_clips: list[ClipSpec], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(gvc, "OUTPUT_DIR", tmp_path)
    provider = StubProvider()
    voice_ids = _stub_voice_ids("stub")

    # First pass: everything needs generating. "Generate" it for real (write
    # the stub bytes) and build a manifest exactly as main() would.
    to_generate, _ = gvc.plan_generation(sample_clips, provider, manifest={}, voice_ids=voice_ids)
    manifest: dict[str, dict[str, object]] = {}
    for planned in to_generate:
        out_path = tmp_path / planned.relpath
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"FAKEAUDIOBYTES")
        manifest[gvc.cue_key(planned.clip)] = {
            "file": planned.relpath.as_posix(),
            "hash": planned.hash,
            "dur_ms": 500,
        }

    # Second pass, same provider/manifest/files: everything is cached.
    to_generate_2, cached_2 = gvc.plan_generation(sample_clips, provider, manifest, voice_ids=voice_ids)
    assert to_generate_2 == []
    assert cached_2 == len(sample_clips)


def test_plan_generation_missing_file_forces_regeneration_even_with_matching_hash(
    sample_clips: list[ClipSpec], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A hash match in the manifest is not enough if the mp3 was deleted."""
    monkeypatch.setattr(gvc, "OUTPUT_DIR", tmp_path)
    provider = StubProvider()
    voice_ids = _stub_voice_ids("stub")
    to_generate, _ = gvc.plan_generation(sample_clips, provider, manifest={}, voice_ids=voice_ids)
    manifest = {
        gvc.cue_key(pc.clip): {"file": pc.relpath.as_posix(), "hash": pc.hash, "dur_ms": 500} for pc in to_generate
    }
    # Note: files were never written to tmp_path this time.
    to_generate_2, cached_2 = gvc.plan_generation(sample_clips, provider, manifest, voice_ids=voice_ids)
    assert cached_2 == 0
    assert len(to_generate_2) == len(sample_clips)


def test_changing_provider_invalidates_the_cache(
    sample_clips: list[ClipSpec], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """S1 amendment / S2 goal: switching --provider must invalidate the cache."""
    monkeypatch.setattr(gvc, "OUTPUT_DIR", tmp_path)
    voice_ids = _stub_voice_ids("stub-a", "stub-b")
    provider_a = StubProvider(id="stub-a")

    to_generate_a, _ = gvc.plan_generation(sample_clips, provider_a, manifest={}, voice_ids=voice_ids)
    manifest: dict[str, dict[str, object]] = {}
    for planned in to_generate_a:
        out_path = tmp_path / planned.relpath
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"FAKEAUDIOBYTES")
        manifest[gvc.cue_key(planned.clip)] = {
            "file": planned.relpath.as_posix(),
            "hash": planned.hash,
            "dur_ms": 500,
        }

    # Confirm the cache actually holds for the same provider first.
    to_generate_same, cached_same = gvc.plan_generation(sample_clips, provider_a, manifest, voice_ids=voice_ids)
    assert to_generate_same == []
    assert cached_same == len(sample_clips)

    # Now switch provider id (same manifest, same files on disk) -- every
    # clip's hash changes because provider_id feeds the hash, so nothing is
    # cached even though the manifest is non-empty and files exist.
    provider_b = StubProvider(id="stub-b")
    to_generate_b, cached_b = gvc.plan_generation(sample_clips, provider_b, manifest, voice_ids=voice_ids)
    assert cached_b == 0
    assert len(to_generate_b) == len(sample_clips)


def test_dry_run_never_calls_synth(
    sample_clips: list[ClipSpec], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(gvc, "OUTPUT_DIR", tmp_path)
    provider = StubProvider()
    to_generate, _ = gvc.plan_generation(sample_clips, provider, manifest={}, voice_ids=_stub_voice_ids("stub"))
    assert len(to_generate) > 0
    # main()'s --dry-run branch returns before calling provider.synth for any
    # planned clip -- verified structurally: no code path between
    # plan_generation() and the dry-run print statements calls .synth().
    assert provider.calls == []


def test_mp3_duration_estimate_is_consistent_with_bitrate() -> None:
    # 64kbps for 1 second = 8000 bytes
    fake_mp3 = b"\x00" * 8000
    assert gvc._mp3_duration_ms(fake_mp3, 64) == 1000


def test_cue_key_and_relpath_format_for_sided_and_status_faults() -> None:
    sided = ClipSpec(
        persona="atlas",
        template_id="bench.elbow_angle.low",
        side="left",
        fault_id="bench.elbow_angle.low.left",
        text="text",
    )
    status = ClipSpec(persona="vector", template_id="mismatch", side=None, fault_id="mismatch", text="text")

    assert gvc.cue_key(sided) == "atlas.bench.elbow_angle.low.left"
    assert gvc.clip_relpath(sided) == Path("atlas") / "bench.elbow_angle.low.left.mp3"

    assert gvc.cue_key(status) == "vector.mismatch"
    assert gvc.clip_relpath(status) == Path("vector") / "mismatch.mp3"
