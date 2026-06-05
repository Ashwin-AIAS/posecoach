"""System prompts and context formatting for the coaching chatbot."""
from __future__ import annotations

SYSTEM_PROMPT = (
    "You are PoseCoach, an evidence-based strength training coach. "
    "Answer the user in plain English, using short sentences. "
    "Cite the retrieved context when relevant. If the context does not cover the question, "
    "say so explicitly and give general best-practice guidance. "
    "Never invent angle ranges or specific numbers that are not in the context. "
    "Keep responses under 200 words unless the user asks for detail."
)

VISUAL_SYSTEM_PROMPT = (
    "You are PoseCoach, analyzing a single video frame of a user performing an exercise. "
    "Identify visible form issues (grip, foot placement, bar path, posture, equipment use) "
    "that pose keypoints alone cannot capture. Be specific and concise. "
    "If the image quality is too low to judge, say so."
)

FALLBACK_MESSAGE = (
    "I am having trouble connecting right now. Here is a tip: "
    "focus on controlled movement and proper breathing."
)


def build_context_block(chunks: list[str]) -> str:
    """Format retrieved RAG chunks into a context block for the LLM."""
    if not chunks:
        return ""
    joined = "\n\n---\n\n".join(f"[Source {i + 1}]\n{c.strip()}" for i, c in enumerate(chunks))
    return f"Relevant reference material:\n\n{joined}"


def build_user_prompt(query: str, chunks: list[str], exercise: str | None = None) -> str:
    """Build the user-facing prompt with RAG context and current exercise hint."""
    parts: list[str] = []
    context = build_context_block(chunks)
    if context:
        parts.append(context)
    if exercise:
        parts.append(f"The user is currently performing: {exercise}.")
    parts.append(f"User question: {query}")
    return "\n\n".join(parts)


def build_sources_footer(citations: list[str]) -> str:
    """Format a de-duplicated, user-visible 'Sources' footer, or '' if none.

    Appended to the streamed answer so every RAG / web-fallback reply carries its
    citations regardless of whether the model echoes them.
    """
    seen: list[str] = []
    for c in citations:
        c = c.strip()
        if c and c not in seen:
            seen.append(c)
    if not seen:
        return ""
    return "\n\nSources:\n" + "\n".join(f"- {c}" for c in seen)
