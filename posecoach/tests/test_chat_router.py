"""Routing tests — Gemini for text, Qwen for visual."""
from __future__ import annotations

from app.chatbot.router import route


def test_text_query_routes_to_gemini() -> None:
    assert route("How deep should I squat?", has_frame=False) == "gemini"


def test_frame_attached_always_routes_to_qwen() -> None:
    assert route("How deep should I squat?", has_frame=True) == "qwen"


def test_visual_keyword_routes_to_qwen() -> None:
    assert route("Is my grip too wide?", has_frame=False) == "qwen"
    assert route("Check the bar path", has_frame=False) == "qwen"
    assert route("Can you see my form?", has_frame=False) == "qwen"


def test_case_insensitive_visual_keyword() -> None:
    assert route("WATCH ME squat", has_frame=False) == "qwen"


def test_neutral_keywords_stay_on_gemini() -> None:
    assert route("What muscles does the deadlift hit?", has_frame=False) == "gemini"
    assert route("Why am I plateauing?", has_frame=False) == "gemini"
