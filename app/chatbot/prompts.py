"""System prompts and context formatting for the coaching chatbot."""
from __future__ import annotations

SYSTEM_PROMPT = (
    "You are **PoseCoach**, an AI-powered strength & conditioning coach built into a "
    "real-time pose-analysis app. You combine deep expertise in exercise biomechanics, "
    "program design, and injury prevention with a warm, motivating personality — like "
    "the best coach at the gym who genuinely wants every athlete to improve.\n\n"
    "## Response guidelines\n"
    "- **Lead with the answer.** Open with a clear, direct response to the question, "
    "then explain the reasoning.\n"
    "- **Use the reference material** provided below as your primary source. Cite it "
    "naturally (e.g. 'research shows…', 'according to the evidence…').\n"
    "- When the reference material doesn't cover the question, say so briefly and give "
    "your best evidence-based guidance from general strength-training principles.\n"
    "- **Never fabricate** specific angle ranges, percentages, or numbers that are not "
    "in the provided context.\n"
    "- **Format with markdown**: bold key terms, use bullet points for lists, and keep "
    "paragraphs short and scannable.\n"
    "- For technique questions, describe what the user should **feel** and what a "
    "correct rep **looks like** — cues a real coach would give on the gym floor.\n"
    "- Be concise (under 200 words) unless the user explicitly asks for detail.\n"
    "- If the user asks about injuries, pain, or supplements, answer helpfully from an "
    "educational standpoint but note it is not medical advice.\n"
    "- **End substantive answers with 1–2 follow-up questions** the user might want to "
    "explore next, formatted as:\n"
    "  > 💡 **Want to go deeper?** Would you like me to break down the hip-hinge cue "
    "in more detail, or should we talk about mobility work to improve your depth?\n"
    "- Format lists and key points clearly; use bullet points when comparing options.\n"
    "- End actionable answers with one concrete next-step the user can try immediately."
)

CONVERSATIONAL_SYSTEM_PROMPT = (
    "You are **PoseCoach**, an AI-powered strength & conditioning coach built into a "
    "real-time pose-analysis app. You're warm, motivating, and genuinely passionate "
    "about helping athletes improve.\n\n"
    "The user is making casual conversation (greeting, thanks, asking who you are, "
    "etc.). Respond naturally and briefly — like a friendly coach at the gym.\n\n"
    "Guidelines:\n"
    "- Keep it short (1–3 sentences).\n"
    "- For greetings: introduce yourself warmly and ask what exercise or topic they "
    "want help with.\n"
    "- For thanks/goodbye: respond graciously and encourage them to come back.\n"
    "- For 'what can you do': briefly list your capabilities (form analysis, exercise "
    "coaching, program advice, injury-prevention tips).\n"
    "- Do NOT use reference material or citations for small talk.\n"
    "- Use a friendly emoji sparingly (one max).\n"
    "- End with an inviting question to start a coaching conversation."
)

VISUAL_SYSTEM_PROMPT = (
    "You are PoseCoach, analyzing a single video frame of a user performing an exercise. "
    "Identify visible form issues (grip, foot placement, bar path, posture, equipment use) "
    "that pose keypoints alone cannot capture. Be specific and concise. "
    "If the image quality is too low to judge, say so."
)

# Generic last-resort fallback — used only when no RAG context was retrieved AND
# the LLM is unreachable. Prefer build_smart_fallback() whenever context exists.
FALLBACK_MESSAGE = (
    "I'm temporarily unable to reach my full knowledge base, but here's what I can "
    "tell you as a coach: focus on bracing your core before every rep, control the "
    "eccentric (lowering) phase for 2–3 seconds, and never grind through a rep where "
    "your form is breaking down. If you have a specific exercise question, try again "
    "in a moment and I'll give you a detailed breakdown."
)

# Exercise-specific fallback tips so even an offline coach sounds knowledgeable.
_EXERCISE_TIPS: dict[str, str] = {
    "squat": (
        "For squats: push your knees out in line with your toes, brace your core hard "
        "before you descend, and aim to break parallel while keeping your chest up. "
        "If your lower back rounds at the bottom, work on ankle and hip mobility first."
    ),
    "deadlift": (
        "For deadlifts: set your back flat by pulling your chest up before you pull, "
        "keep the bar close to your shins, and drive through your whole foot. The bar "
        "should travel in a straight vertical line — if it drifts forward, you'll feel "
        "it in your lower back."
    ),
    "bench": (
        "For bench press: retract your shoulder blades and plant them into the bench, "
        "keep your feet flat on the floor, and lower the bar to your lower chest with "
        "your elbows at roughly 45° — not flared out to 90°."
    ),
    "ohp": (
        "For overhead press: brace your core as if someone is about to punch you in the "
        "stomach, press the bar in a slight arc around your face then lock out directly "
        "overhead, and squeeze your glutes to prevent your lower back from arching."
    ),
    "curl": (
        "For curls: keep your elbows pinned to your sides, control the lowering phase "
        "for at least 2 seconds, and avoid swinging your torso. If you need momentum to "
        "lift the weight, it's too heavy."
    ),
    "lunge": (
        "For lunges: take a step long enough that both knees form roughly 90° at the "
        "bottom, keep your torso upright, and push back up through your front heel. "
        "If your knee caves inward, try a lighter weight or bodyweight first."
    ),
    "plank": (
        "For planks: squeeze your glutes, brace your abs, and keep a straight line from "
        "ears to ankles. Don't let your hips sag or pike up — both reduce core activation."
    ),
}


def build_smart_fallback(
    query: str,
    chunks: list[str],
    exercise: str | None = None,
) -> str:
    """Build a useful fallback when the LLM is unreachable.

    Priority order:
    1. If we retrieved relevant KB chunks, summarise the most relevant one.
    2. If we know the current exercise, give exercise-specific coaching.
    3. Generic professional fallback.
    """
    # 1) Use retrieved context — the KB was already searched successfully.
    if chunks:
        best = chunks[0].strip()
        # Take the first ~500 chars to keep it concise.
        if len(best) > 500:
            best = best[:500].rsplit(" ", 1)[0] + "…"
        return (
            f"Here's what I found in my coaching knowledge base:\n\n{best}\n\n"
            "I'm having a brief connection issue for a more tailored answer — "
            "try asking again in a moment for a full breakdown."
        )

    # 2) Exercise-specific tip.
    if exercise:
        ex_lower = exercise.lower()
        for key, tip in _EXERCISE_TIPS.items():
            if key in ex_lower:
                return (
                    f"{tip}\n\n"
                    "I'm having a brief connection issue right now — try again "
                    "shortly and I'll give you a more detailed answer."
                )

    # 3) Try to match the query itself to an exercise.
    q_lower = query.lower()
    for key, tip in _EXERCISE_TIPS.items():
        if key in q_lower:
            return (
                f"{tip}\n\n"
                "I'm having a brief connection issue right now — try again "
                "shortly and I'll give you a more detailed answer."
            )

    # 4) Last resort.
    return FALLBACK_MESSAGE

# Appended to injury / supplement answers — educational framing, not a refusal.
SAFETY_NOTE = (
    "\n\nNote: this is general educational information, not medical advice — for "
    "diagnosis, treatment, or specific supplement dosing, please see a qualified "
    "professional."
)

# Terms that mark a query as injury- or supplement-related, where a brief
# not-medical-advice note belongs. Kept conservative; a false positive only adds
# a harmless disclaimer.
_SAFETY_KEYWORDS = frozenset(
    {
        # injury / rehab
        "injury",
        "injured",
        "pain",
        "hurt",
        "rehab",
        "physio",
        "sprain",
        "strain",
        "tear",
        "torn",
        "tendon",
        "tendonitis",
        "tendinitis",
        "dislocat",
        "fracture",
        "swollen",
        # supplements / dosing
        "supplement",
        "creatine",
        "protein powder",
        "pre-workout",
        "pre workout",
        "preworkout",
        "dosage",
        "dose",
        "fat burner",
        "testosterone",
        "steroid",
        "sarm",
    }
)


def is_safety_sensitive(query: str) -> bool:
    """True if the query is injury- or supplement-related (needs the safety note)."""
    lowered = query.lower()
    return any(keyword in lowered for keyword in _SAFETY_KEYWORDS)


def build_context_block(chunks: list[str]) -> str:
    """Format retrieved RAG chunks into a context block for the LLM."""
    if not chunks:
        return ""
    joined = "\n\n---\n\n".join(f"[Source {i + 1}]\n{c.strip()}" for i, c in enumerate(chunks))
    return f"Relevant reference material:\n\n{joined}"


def build_user_prompt(
    query: str,
    chunks: list[str],
    exercise: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> str:
    """Build the user-facing prompt with RAG context, exercise hint, and history.

    When ``history`` is provided (list of ``{"role": ..., "content": ...}`` dicts),
    a compact conversation transcript is prepended so the LLM has multi-turn context.
    """
    parts: list[str] = []

    # Multi-turn context (if present)
    if history:
        convo_lines: list[str] = []
        for turn in history:
            role = turn.get("role", "user")
            content = turn.get("content", "")
            label = "User" if role == "user" else "Coach"
            convo_lines.append(f"{label}: {content}")
        parts.append("Previous conversation:\n" + "\n".join(convo_lines))

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
