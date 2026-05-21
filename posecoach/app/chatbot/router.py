"""Routing logic — decides which LLM handles a given query.

Rule of thumb:
- If a frame snapshot is attached → Qwen (multimodal reasoning)
- If the text mentions visual concepts (grip, bar path, equipment, etc.) → Qwen
- Otherwise → Gemini 2.0 Flash (cheaper, faster, plenty for text Q&A)
"""
from __future__ import annotations

from typing import Literal

Provider = Literal["gemini", "qwen"]

# Visual keywords that hint the user wants something only a VLM can answer.
# Keep this list short and conservative — false positives just route to a
# slightly more expensive model, false negatives skip vision entirely.
_VISUAL_KEYWORDS = frozenset(
    {
        "grip",
        "bar path",
        "barpath",
        "foot placement",
        "stance width",
        "shoe",
        "shoes",
        "equipment",
        "belt",
        "wrist wrap",
        "look at",
        "see my",
        "is my form",
        "watch me",
        "video",
        "image",
        "picture",
        "photo",
        "snapshot",
    }
)


def route(query: str, has_frame: bool) -> Provider:
    """Return the LLM provider that should handle this query."""
    if has_frame:
        return "qwen"
    lowered = query.lower()
    if any(keyword in lowered for keyword in _VISUAL_KEYWORDS):
        return "qwen"
    return "gemini"
