# FIX — Single-Arm Exercises Scored & Cued as Both Arms

> Autonomous task brief for Claude Code. Self-contained. Work until **every**
> item in section 8 (Definition of Done) is checked. The scorer is deterministic
> and thesis-measured — do not introduce randomness or break existing tests.

---

## 1. Problem (observed)

When the user performs a **one-arm** movement — e.g. a single-arm dumbbell curl
with the **right** arm while the **left** arm hangs straight at the side — the
model "calls both hands": it scores and gives cues for the **idle** arm too. The
straight resting arm is treated as "not curling", which:
- drags the overall form score down (the idle arm scores low/zero), and
- emits a misleading cue (e.g. "Curl higher for peak squeeze") for an arm the user
  is intentionally resting.

This is **not** a second-person / wrong-person detection problem. It is the user's
own idle arm being scored. (Person-selection is a separate concern; do not touch
inference/person-picking here.)

## 2. Root cause (already diagnosed — verify in code, then fix)

In `app/analysis/form_scorer.py`:
- `_EXERCISE_JOINTS["curl"] = ["left_elbow_angle", "right_elbow_angle"]` (and the
  same bilateral pairing exists for `hammer_curl`, `drag_curl`, `lateral_raise`,
  `front_raise`, `one_arm_row`, etc.).
- `score_exercise()` computes a per-joint score for **every** listed joint and
  takes `overall = np.mean(list(joint_scores.values()))`. So both elbows are
  always averaged.
- The cue loop appends a cue for **any** joint scoring < 100, including the idle
  arm.

When both elbow keypoints are visible (user facing the camera, only one arm
working), the idle straight arm (~160–180°) falls outside the curl mover band and
scores low → halves the mean and produces a bad cue.

Note: in a true side-on/profile stance the far arm's keypoints are often gated out
by `ANGLE_CONF_THRESHOLD` (angle becomes `None`) and already skipped — so this fix
specifically targets the **front-facing, both-arms-visible, one-arm-working** case.

## 3. Goal

For paired-limb exercises, when the user is clearly working **one** side only,
score and cue **only the active side**; when both sides are genuinely working
(normal bilateral execution), behave exactly as today. No regression to bilateral
scoring, determinism, or the < 5% consistency target.

## 4. Recommended approach (unilateral detection by ROM divergence)

Implement a per-frame, **stateless and deterministic** heuristic inside the scorer
(no temporal/motion state — keep it pure so `test_form_consistency` stays green):

1. Identify exercises with a symmetric left/right pair of **mover** joints (curl,
   hammer_curl, drag_curl, lateral_raise, front_raise, and any future arm pair).
   Add a small data structure, e.g. `_UNILATERAL_CAPABLE: dict[str, tuple[str, str]]`
   mapping exercise → (left_joint, right_joint), driven by existing
   `_EXERCISE_JOINTS` — do **not** inline magic joint names per exercise body.
2. For such an exercise, after computing both joint angles (both non-None):
   - Compute each side's "engagement": how far inside its **mover ROM** [p5, p95]
     the angle sits (use the existing `joint_range` / `_score_joint` machinery —
     the active arm scores high while flexing; the idle straight arm sits near the
     extension extreme).
   - If the two sides **diverge sharply** — one side is engaged (within working
     band) and the other is held near full extension/rest, beyond a margin derived
     from the Fit3D percentiles (**not** a hardcoded magic number) — classify the
     frame as **unilateral** and select the **active** side only.
   - Otherwise treat as **bilateral** (score/average both, as today).
3. When unilateral: `joint_scores` and `measured_angles` include only the active
   side; `overall` = the active side's score; cues are generated for the active
   side only. The idle arm is neither scored nor cued.
4. Only one valid side present (other is `None` from the conf gate): score that one
   side — this already mostly happens, but make it explicit and covered by a test.

Keep all thresholds/margins **derived from `angle_ranges.json` percentiles**, never
inlined (project rule: no inline magic angle values).

## 5. Alternative (only if 4 proves unreliable)

Add an explicit **unilateral mode** signalled from the UI (e.g. `mode`/`side` field
on the WS frame: `"both" | "left" | "right"`), and have `score_exercise` accept an
optional `active_side` argument. Deterministic and unambiguous, at the cost of a UI
toggle. Prefer the automatic approach in section 4; fall back to this only if the
heuristic can't separate unilateral from bilateral cleanly. **Ask Ashwin before
choosing this path** (it changes the WS contract + frontend).

## 6. Constraints (from project rules — do not violate)

- Scorer must be **deterministic**: same input → same output, no randomness.
- Form score consistency must stay **< 5% variance** over 20 identical inputs.
- Angle ranges/thresholds come from `ANGLE_RANGES` / `angle_ranges.json` — never
  inline magic angle values in logic.
- Cue strings ≤ 8 words, plain English (reuse existing `_CUES`).
- `ruff check app/ --fix`, `ruff format app/`, and `mypy app/ --strict` must pass.
  All functions fully typed; Google-style docstrings on public functions; no bare
  `except`; module-level UPPER_SNAKE_CASE constants.
- Logging via `structlog.get_logger(__name__)` only — never `print()`.
- Coverage on `app/analysis/` must stay **≥ 80%** (`--cov-fail-under=80`).
- Tests use **SQLite in-memory** patterns where DB is involved; scorer tests are
  pure-function (synthetic 17-keypoint fixtures).
- **This repo lives in OneDrive** — verify edits are non-truncated (`wc`, `python
  -c "import ast,sys; ast.parse(open('app/analysis/form_scorer.py').read())"`).

## 7. Verification

- `pytest tests/test_form_scorer.py -v` — all 7+ exercises still return valid
  `FormResult`.
- `pytest tests/test_form_consistency.py -v` — 20 identical inputs < 5% variance,
  unchanged.
- **New tests (required), add to `tests/test_form_scorer.py` or a new
  `tests/test_unilateral_scoring.py`:**
  - One-arm curl fixture (right elbow flexing ~60°, left elbow straight ~175°) →
    score reflects the **active** arm only; no left-arm cue; score is good, not
    halved.
  - Genuine bilateral curl fixture (both elbows flexing together) → both scored
    and averaged exactly as before (regression guard).
  - Single visible side (left elbow `None` via low conf) → scores the right side.
- `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80` — passes.
- (If touched) `python scripts/eval_form_consistency.py` still passes its gate.

## 8. Definition of Done

- [x] Unilateral detection implemented per section 4, data-driven from
      `_EXERCISE_JOINTS` / Fit3D percentiles; no inline magic numbers.
      (`_mover_pair` derives the candidate exercise→joint-pair map; `_is_engaged`
      derives its edge band from each joint's own p5/p95 span.)
- [x] One-arm execution scores & cues the **active** arm only; idle arm ignored.
- [x] Bilateral execution unchanged (regression test proves it).
- [x] Determinism preserved; `test_form_consistency` < 5% variance still green
      (determinism_cv_pct stays 0.0 for every exercise — the separate
      noise-robustness metric in `eval_form_consistency.py` was already below
      its own gate before this change and is untouched by it).
- [x] New tests cover one-arm, bilateral, and single-visible-side cases
      (`tests/test_unilateral_scoring.py` — curl and lateral_raise).
- [x] `ruff`, `mypy --strict`, full `pytest` with coverage ≥ 80% all pass
      (564 passed, 97.34% on `app/analysis/`).
- [x] `form_scorer.py` verified non-truncated (parses via `ast`).
- [ ] Confirmed on the live tool by a human (Ashwin) with a real one-arm curl.

## 9. Out of scope

- Person selection / multi-person tracking / which detection is chosen by the
  ONNX head (separate issue).
- Latency / quantization work (muted by Ashwin).
- Frontend changes — unless the section 5 alternative is explicitly approved.
