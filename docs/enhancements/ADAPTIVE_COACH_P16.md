# P16 — Adaptive Coach: Session Feedback Loop (Freeletics-style)

## Goal
Close the loop between sessions. After each workout the user gives a 1-tap effort
rating; combined with objective form scores already stored in `WorkoutSession`,
a deterministic engine recommends the next session's load and focus. No LLM in
the loop — pure rules, fully testable. This is PoseCoach's differentiation vs.
Freeletics: they adapt on self-report only, we adapt on self-report + measured form.

## Scope (build exactly this, nothing more)
1. DB: `effort_rating` column on `workout_sessions`
2. API: submit feedback + get recommendation
3. Engine: `app/analysis/adaptive.py` (deterministic)
4. UI: effort question in SessionSummary + recommendation card before next workout
5. Tests for all of the above

Out of scope: multi-week plans, streaks, notifications, LLM-generated advice.

---

## Step 1 — Migration (Alembic, never create_all)
New revision `0003_effort_rating`:
- `workout_sessions.effort_rating: Integer, nullable=True` — values 1–5
  (1 = too easy, 3 = just right, 5 = too hard)
Add the field to `WorkoutSession` in `app/models.py` (flat file, keep style):
```python
effort_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

## Step 2 — Recommendation engine: `app/analysis/adaptive.py`
Deterministic. Same inputs → same output. Fully typed, mypy --strict clean.

```python
@dataclass(frozen=True)
class Recommendation:
    exercise: str
    rep_target_delta: int      # -2, 0, or +2 vs last session's rep_count
    focus_joint: str | None    # worst-scoring joint from last session, if any
    message: str               # <= 12 words, plain English, no jargon
```

`def recommend(sessions: Sequence[WorkoutSession]) -> Recommendation | None:`
- Input: most-recent-first sessions of ONE exercise for one user
- Return `None` if fewer than 2 completed sessions (cold start — UI shows nothing)
- Rules (apply first match):
  | Condition (last session) | rep_target_delta | message theme |
  |---|---|---|
  | effort <= 2 AND avg_form_score >= 80 | +2 | progress: add reps |
  | effort >= 4 OR avg_form_score < 60 | -2 | back off, fix form |
  | effort is None | 0 | neutral, cite form trend |
  | otherwise | 0 | hold, polish focus_joint |
- `focus_joint`: reuse the existing worst-joint computation (see the worst-joint
  feature in the analysis/ or frontend stats path — find it with grep, do NOT
  reimplement the math). If unavailable for plank-style sessions, use None.
- Plank special case: it has hold_duration not reps — delta applies to seconds
  (+/-10s); keep the same Recommendation shape, mention seconds in message.
- Constants at module level (UPPER_SNAKE_CASE): thresholds 80/60, deltas, min sessions.

## Step 3 — API (`app/api/v1/history.py`, same router)
1. `PATCH /api/v1/history/sessions/{session_id}/feedback`
   - Body: `{"effort": int}` — validate 1–5 (422 otherwise)
   - Ownership check identical to existing get/delete (404 if not owner)
   - Idempotent: overwriting an existing rating is fine
   - Response: updated SessionSummary
2. `GET /api/v1/history/recommendation?exercise=squat`
   - Validate exercise against the 7 supported names (422 otherwise)
   - Fetch last 5 sessions of that exercise for the current user, call `recommend()`
   - Response: Recommendation JSON, or `204 No Content` when None
- Auth: same current-user dependency as the rest of history.py
- Log with structlog only: `logger.info("feedback_saved", session_id=..., effort=...)`
  — never log keypoints or PII beyond user_id

## Step 4 — Frontend
1. `SessionSummary.tsx`: after stats, add "How hard was that?" with 3 buttons —
   Too easy (1) / Just right (3) / Too hard (5). On tap: PATCH feedback, show a
   small check, disable buttons. Tailwind only, no inline styles. New api.ts helper.
2. Recommendation card: when an exercise is selected (ExerciseSelector flow),
   GET recommendation; if 200, render one-line card above the start button, e.g.
   "Last squat: 82 avg — try +2 reps, watch knee depth." 204 → render nothing.
3. Types in `types.ts`: `EffortRating = 1 | 3 | 5`, `Recommendation` interface
   mirroring the backend dataclass. No `any`.

## Step 5 — Tests
- `tests/test_adaptive.py`: parametrized over all rule branches + plank case +
  cold start (None) + determinism (call twice, assert equal). Synthetic
  WorkoutSession objects, no DB needed.
- `tests/test_history.py`: extend — feedback happy path, 422 on effort=0/6,
  404 on other user's session, recommendation 200 + 204 paths.
- Frontend: `SessionSummary` test — tap button fires PATCH (vitest, mock fetch).
- Remember: SQLite in-memory fixtures from conftest.py, asyncio_mode=auto
  (no decorator), respx/fakeredis where relevant.

## Quality gate (must pass before commit)
```bash
ruff check app/ --fix
mypy app/ --strict
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
cd frontend && npx vitest run
```

## Commit
```
[P16] feat: adaptive session feedback loop (effort rating + recommendation engine)
```

## Hard constraints (repeat-offenders — do not violate)
- Alembic migration, never `Base.metadata.create_all()`
- structlog only — no print(), no logging.getLogger()
- Deterministic engine — no randomness, no LLM calls
- Absolute imports, Google docstrings, full typing
- Do not touch inference/YOLO code paths at all
