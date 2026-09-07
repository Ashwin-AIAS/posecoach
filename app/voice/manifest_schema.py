"""Shared schema version for ``frontend/public/voice/manifest.json`` (P29 S8).

Single source of truth for both the writer (``scripts/gen_voice_clips.py``)
and the reader (``app/voice/router.py``) so they can never drift on the
manifest's wire/on-disk shape independently.

Bump this whenever that top-level shape changes. The version field lets a
stale HTTP-cached copy (``Cache-Control: public, max-age=86400`` on
``GET /api/v1/voice/manifest``) be *detected* by the frontend instead of
silently misparsed — see ``useCoachVoice.ts``'s manifest fetch, which treats
any other version exactly like "manifest not generated yet" (voice stays
unavailable; `CueToast` still shows the text twin).

History:
    1 -- (implicit) flat ``{cue_key: {file, hash, dur_ms}}``, S2-S7.
    2 -- ``{version, clips: {cue_key: ...}, faults: {"exercise::cue_text": fault_id}}``,
         S8 -- adds the S1 fault-taxonomy lookup so the client-side
         `cueArbiter` can resolve an incoming WS cue string to a fault id
         without a second route or a second static asset (S8 decision).
"""

MANIFEST_SCHEMA_VERSION = 2
