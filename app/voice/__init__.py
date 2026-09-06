"""P29 voice coach — persona-driven spoken cues at rep boundaries.

Read-only consumer of the existing WebSocket message stream. Never imports
into, and is never imported by, ``app/analysis/**``, ``app/inference/**``,
``app/api/v1/ws_inference.py``, or the model lifespan setup — see
``docs/prompts/P29_VOICE_COACH_PERSONAS.md`` §1.
"""
