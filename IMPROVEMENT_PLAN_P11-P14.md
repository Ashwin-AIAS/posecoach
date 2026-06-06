# PoseCoach — Post-Gym-Test Improvement Plan (P11 → P14)

> **Audience:** Claude Code, working inside the `posecoach/` project.
> **Origin:** Real-world gym usage feedback from Ashwin (2026-06-05).
> **Status:** PoseCoach is now a personal tool + future startup (thesis dropped). Optimise for
> *real-world usefulness and trustworthiness*, not thesis-metric gates.

---

## How To Execute This File (READ FIRST)

1. **Execute strictly in order: P11 → P12 → P13 → P14.** Do not start a phase until the
   previous phase's *Acceptance Criteria* all pass.
2. **Work autonomously until each phase is DONE.** "Done" = every checkbox in that phase's
   *Acceptance Criteria* is satisfied and verified. If a step fails, debug and retry — do not
   skip ahead, do not leave a phase half-finished.
3. **Commit after every numbered section** (not just every phase). Use the repo commit format:
   ```
   [P1X] type: short description (≤72 chars)

   - what changed
   - why
   ```
   Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
4. **Respect ALL existing project rules.** In particular `.claude/rules/yolo26.md`
   (NEVER `end2end=False`, keypoints via `.xyn`, model loaded once in lifespan, inference in
   executor), `.claude/rules/code-style.md` (ruff + mypy --strict + Google docstrings, absolute
   imports), `.claude/rules/testing.md` (SQLite in-memory, `asyncio_mode=auto`), and
   `.claude/rules/privacy-and-thesis.md` (no frames to disk, JWT httpOnly only).
5. **Quality gate before every commit:**
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   ```
   All three must pass. Frontend changes additionally run `cd frontend && npx vitest run`.
6. **Logging:** `structlog` everywhere. Never `print()` / `logging.getLogger()`. Never log
   frames, raw keypoint arrays, tokens, or PII beyond `user_id`.
7. **Before touching a file, read it.** Don't assume structure from this doc — confirm against
   the actual code. If reality differs from the file paths below, follow reality and note it in
   the commit body.

> **Definition of "keep working":** After finishing P14, re-run the full quality gate and a
> manual smoke test of all four features. Only then report completion. If any acceptance
> criterion is unmet, loop back and fix it — the goal is a working, trustworthy app, not a
> checklist of attempts.

---

## P11 — Reference Video as a Separate, On-Demand Section

**Problem (user words):** "The YouTube reference video pops up while tracking the pose. I don't
want it shown explicitly while tracking — I want it in a separate Reference Video section that I
open when I choose to." The curated videos themselves are fine; this is purely about *where and
when* the video appears.

**Goal:** The reference video must NEVER auto-render on the live pose-tracking screen. It lives
in its own clearly separated section/tab the user opens deliberately.

### P11.1 — Locate and audit current behaviour
- [ ] Find where the reference video is currently rendered (search `frontend/src` for
      `youtube`, `iframe`, `ReferenceVideo`, `embed`, the video URL map, etc.).
- [ ] Identify the component that mounts it during tracking and confirm it shares the live
      tracking view (the WebSocket pose component).
- [ ] Write a one-paragraph note in the commit body describing current coupling.
- [ ] **Commit:** `[P11] docs: audit reference-video coupling with tracking view`

### P11.2 — Extract a standalone ReferenceVideo section
- [ ] Create/relocate a `ReferenceVideoPanel` component that owns the per-exercise video map
      (keep the existing curated URLs — do not change the links).
- [ ] Render it in its own section/tab/route — e.g. a "Reference" tab or a collapsible panel
      that is **collapsed by default** and visually separate from the live camera/tracking area.
- [ ] Remove the reference-video render from the live tracking component entirely. The tracking
      screen shows camera + skeleton + score/cues only.
- [ ] Lazy-load the iframe (only mount the YouTube embed when the section is actually opened) so
      it doesn't load network/bandwidth during a workout. Respect the existing adaptive-quality
      ethos.
- [ ] TypeScript strict, no `any`, Tailwind utility classes only, PascalCase component.
- [ ] **Commit:** `[P11] feat: move reference video into standalone on-demand section`

### P11.3 — Tests + verification
- [ ] Vitest: assert the tracking view does NOT render the video iframe while tracking is active.
- [ ] Vitest: assert the ReferenceVideo section renders the correct URL for a given exercise and
      is collapsed/hidden by default.
- [ ] Manual smoke: start tracking → confirm no video appears; open Reference section → video
      plays.
- [ ] **Commit:** `[P11] test: reference video hidden during tracking, shown on demand`

### P11 Acceptance Criteria
- [ ] Starting pose tracking shows zero reference video.
- [ ] Reference video is reachable in its own section, collapsed by default, correct per exercise.
- [ ] Iframe is lazy-mounted (no load until opened).
- [ ] `vitest run` green; ruff/mypy green (if any TS-adjacent backend touched).

---

## P12 — Rep Counter Overhaul

**Problem:** Rep counting needs to improve "a lot." Current best (`rep_counter` v5) ≈ 71%
accuracy vs ground truth — not good enough for a personal training tool.

**Goal:** A robust, real-time-capable rep counter that works across the 7 exercises and validates
materially higher than the current ~71% against the Vicon/Fit3D ground truth.

> **Design note:** Pure offline `scipy.signal.find_peaks` over a whole series is fine for
> post-hoc validation but weak for live streaming (it sees the future). Move to an online
> **hysteresis state machine** for live counting, and keep `find_peaks` only as the offline
> validation oracle.

### P12.1 — Diagnose why v5 misses
- [ ] Read the current `rep_counter` implementation and its validation script
      (`scripts/eval` or `tests/test_rep_counter.py`).
- [ ] Run the existing validation and capture per-exercise accuracy (which exercises drag the
      average down?). Save the breakdown to `data/eval/rep_counter_diagnosis.json`.
- [ ] Identify failure modes: double-counts at the bottom, missed shallow reps, wrong primary
      joint for upper-body lifts (knee flexion is meaningless for curl/bench/ohp/row).
- [ ] **Commit:** `[P12] docs: diagnose rep counter v5 failure modes per exercise`

### P12.2 — Per-exercise signal selection
- [ ] Define a `REP_SIGNAL` mapping (module-level UPPER_SNAKE constant, no inline magic) that
      picks the driving joint-angle per exercise:
      - squat / lunge → knee flexion
      - deadlift → hip hinge (hip angle), with knee as secondary
      - curl → elbow flexion
      - bench / ohp → elbow flexion (and/or shoulder)
      - row → elbow flexion + shoulder retraction proxy
      - plank → N/A (hold, not reps — see P12.5)
- [ ] Use confidence-gated keypoints only (skip joints with `conf < 0.5`, per project rule).
- [ ] **Commit:** `[P12] feat: per-exercise rep signal selection`

### P12.3 — Online hysteresis state machine (live counting)
- [ ] Implement a two-threshold state machine per rep: `TOP` and `BOTTOM` states with a hysteresis
      band so noise near a threshold cannot double-count. A rep increments on a full
      TOP→BOTTOM→TOP cycle.
- [ ] Derive thresholds from the exercise's `ANGLE_RANGES` (biomechanically grounded) rather than
      hard-coded magic numbers.
- [ ] Feed the angle signal through the existing EMA smoothing before the state machine
      (reuse `score_smoother`/keypoint smoothing patterns; one instance per WS connection;
      `.reset()` on disconnect).
- [ ] Add a minimum-time/ minimum-amplitude guard to reject micro-bounces.
- [ ] Deterministic: same input → same count. No randomness.
- [ ] **Commit:** `[P12] feat: online hysteresis rep state machine`

### P12.4 — Keep find_peaks as offline validation oracle
- [ ] Keep/clean the offline `find_peaks` path for batch validation against ground truth
      (`prominence`, `distance` tuned per exercise).
- [ ] **Commit:** `[P12] refactor: isolate offline find_peaks validation path`

### P12.5 — Plank stays a hold timer
- [ ] Confirm plank returns `hold_duration` (not reps) and is unaffected by the rep machine.
- [ ] **Commit:** `[P12] fix: ensure plank uses hold timer not rep count`

### P12.6 — Tests + revalidation
- [ ] Unit tests with synthetic angle curves for each rep-based exercise (clean reps, noisy reps,
      shallow reps, double-bounce) asserting exact counts.
- [ ] Re-run validation vs Vicon/Fit3D ground truth; write
      `data/eval/rep_counter_validation.json` with per-exercise + overall accuracy.
- [ ] **Acceptance target:** overall accuracy materially above the 71% baseline (aim ≥ 90%; if an
      exercise can't reach it, log why in the JSON and the commit body — honesty over fudging).
- [ ] **Commit:** `[P12] test: revalidate rep counter, record per-exercise accuracy`

### P12 Acceptance Criteria
- [ ] Live counting uses the online state machine, not whole-series peak detection.
- [ ] Each rep-based exercise has the correct driving signal.
- [ ] Overall validated accuracy clearly beats 71% (target ≥ 90%, documented if short).
- [ ] Plank unaffected. Deterministic. Quality gate green.

---

## P13 — Form-Score Trust: Exercise Verification + Stricter Scoring (PRIORITY)

**Problem (user words):** "I chose deadlift and was doing RDL — it showed 90% form correct. I chose
row and was on an iso-lateral chest-supported machine — and it still gave a score. The score is
always good, so I'm not sure it's true." Two failures: (a) no check that you're actually doing the
chosen exercise, and (b) scores are not discriminative — everything reads high.

**Goal:** The score becomes *trustworthy*. If the movement doesn't match the chosen exercise, flag
it instead of silently scoring. When it does match, a poor rep must actually lose points.

### P13.1 — Exercise-verification gate (NEW)
- [ ] Add `app/analysis/exercise_verifier.py`: given the chosen exercise + the live keypoint
      sequence, decide whether the observed movement is consistent with that exercise.
- [ ] Use interpretable, biomechanical signals (no black-box classifier needed):
      - Which joints are actually moving (range of motion per joint over the rep)?
      - Does the movement signature match the expected pattern? e.g. **deadlift vs RDL**:
        deadlift has substantial knee flexion + hip hinge; RDL is hip-hinge-dominant with
        near-static knees → if knee ROM is below a threshold while hip hinges, it's an RDL, not a
        conventional deadlift → flag mismatch.
      - **row (chosen) vs chest-supported machine**: torso is horizontal/supported and the pull is
        machine-guided → torso-angle + elbow-path signature won't match a free-standing barbell/
        dumbbell row → flag "this doesn't look like a standing row."
- [ ] Define expected movement signatures as a module-level constant
      (`EXERCISE_SIGNATURES`, UPPER_SNAKE), sourced from `angle_ranges.json` where possible — never
      inline magic numbers.
- [ ] Output a structured result: `verified: bool`, `confidence: float`,
      `detected_hint: str | None` (e.g. `"looks like RDL, not deadlift"`).
- [ ] When `verified=False`, the scorer must NOT emit a normal high score — it returns a
      `mismatch` state and a plain-English cue (≤ 8 words), e.g. `"Looks like RDL — pick RDL"`.
- [ ] **Commit:** `[P13] feat: exercise verification gate (reject wrong-exercise scoring)`

### P13.2 — Recalibrate ANGLE_RANGES to be discriminative
- [ ] Audit current `ANGLE_RANGES` / `angle_ranges.json`: the "always high score" symptom usually
      means ranges are too wide (almost any angle falls inside) or the scoring curve saturates.
- [ ] Tighten ranges using the Fit3D/Vicon golden templates so a genuinely good rep scores high
      and a sloppy rep (shallow depth, bad back angle, partial ROM) measurably drops.
- [ ] Replace any flat in-range/out-of-range step with a graded penalty curve (distance from the
      ideal band scales the deduction) so scores spread across 0–100 instead of clustering near
      the top.
- [ ] Keep ranges in `angle_ranges.json` — never inline. Keep the scorer deterministic.
- [ ] **Commit:** `[P13] fix: recalibrate angle ranges + graded penalties for discriminative scoring`

### P13.3 — Per-rep / per-joint breakdown
- [ ] Extend the form result to report *why* a score was given: per-joint contribution and the
      worst joint for the rep (you already ship a worst-joint feature — surface it per rep).
- [ ] Surface the verification state in the WS payload and the frontend (a clear
      "⚠ This doesn't look like {exercise}" banner when `verified=False`).
- [ ] **Commit:** `[P13] feat: per-rep joint breakdown + mismatch banner`

### P13.4 — Tests
- [ ] `test_exercise_verifier.py`: feed an RDL keypoint sequence with chosen=deadlift → expect
      `verified=False`, hint mentions RDL. Feed a correct deadlift → `verified=True`.
- [ ] Add a chest-supported-machine-style signature vs chosen=row → expect mismatch.
- [ ] `test_form_scorer`: assert a deliberately poor rep scores materially lower than a clean rep
      for all 7 exercises (kills the "always high" bug).
- [ ] Keep `test_form_consistency` green (< 5% variance on identical inputs — determinism must
      survive recalibration).
- [ ] **Commit:** `[P13] test: verification + discriminative scoring across 7 exercises`

### P13 Acceptance Criteria
- [ ] Wrong-exercise input is flagged, not silently scored high.
- [ ] A clean rep and a sloppy rep produce clearly different scores (no top-cluster saturation).
- [ ] Per-rep breakdown + mismatch banner visible in the UI.
- [ ] Determinism preserved; coverage ≥ 80% on `app/analysis`; quality gate green.

---

## P14 — Chatbot / RAG Expansion (Expand KB + Live Web Fallback)

**Problem (user words):** The chatbot "has to improve a lot." Goal: answer **any** question about
gym exercises, injury, supplements, nutrition, programming, and sports in general — genuinely
useful coverage for an individual.

**Goal:** Broaden the RAG knowledge base across all those domains AND add a live web-search
fallback when local RAG can't confidently answer — routed through the existing smart router
(visual → Qwen 3.6, text → Gemini 2.0 Flash) with citations.

> **Keep existing rules:** Gemini 2.0 Flash only (not pro/1.5), SSE streaming (not WebSocket),
> 10 req/min rate limit on `/chat/stream`, ChromaDB `persist_directory` from `CHROMA_PATH`, and
> the existing fallback message on LLM failure.

### P14.1 — Expand the knowledge base
- [ ] Curate and ingest content across domains: exercise technique, injury
      prevention/rehab (general, not medical diagnosis), supplements, nutrition/macros, program
      design (hypertrophy/strength/conditioning), recovery/sleep, and broader sports science.
- [ ] Organise sources with metadata (domain tag, source title, URL) so citations are possible.
- [ ] Update `app/chatbot/ingest.py` and re-run `python -m app.chatbot.ingest`; verify Chroma
      persists to `CHROMA_PATH`.
- [ ] **Commit:** `[P14] feat: expand RAG knowledge base across injury/supplements/nutrition/programming`

### P14.2 — Confidence-gated retrieval + web fallback
- [ ] In the RAG path, compute a retrieval-confidence signal (e.g. top-k similarity threshold).
      If retrieved context is weak/empty, trigger a **live web-search fallback**.
- [ ] Implement the web fallback behind a clean interface (a `web_search` tool) so the LLM answers
      from fresh results when RAG is insufficient. Key in env var only (never hardcoded).
- [ ] Always cite: RAG answers cite KB sources; web-fallback answers cite the fetched URLs.
- [ ] Preserve smart routing (visual+frame → Qwen via OpenRouter; text-only → Gemini Flash).
- [ ] Keep the existing LLM-failure fallback message intact.
- [ ] **Commit:** `[P14] feat: confidence-gated RAG with live web-search fallback + citations`

### P14.3 — Safety framing for injury/supplements
- [ ] For injury and supplement questions, the assistant gives general educational info and adds a
      brief "not medical advice — see a professional for diagnosis/dosing" note. Do not refuse
      outright; do not invent dosages or diagnoses.
- [ ] **Commit:** `[P14] feat: educational safety framing for injury/supplement answers`

### P14.4 — Tests
- [ ] Mock Gemini + OpenRouter with `respx`; mock the web-search tool. Never hit real APIs in tests.
- [ ] Test: a question covered by the expanded KB answers from RAG with a citation.
- [ ] Test: a question NOT in the KB triggers the web fallback path and returns a cited answer.
- [ ] Test: rate limit (10/min) still enforced; SSE still used; failure fallback message intact.
- [ ] **Commit:** `[P14] test: RAG-vs-web routing, citations, rate limit, fallback`

### P14 Acceptance Criteria
- [ ] KB covers injury, supplements, nutrition, programming, and general sports.
- [ ] Out-of-KB questions fall back to web search and answer with citations.
- [ ] Smart routing, SSE, rate limit, and failure fallback all preserved.
- [ ] Injury/supplement answers carry the educational-safety note.
- [ ] Quality gate green.

---

## Final Pass (Do Not Skip)

- [ ] Re-run the full quality gate: `ruff check app/ --fix && mypy app/ --strict && pytest -x
      --timeout=30 --cov=app/analysis --cov-fail-under=80`, plus `cd frontend && npx vitest run`.
- [ ] Manual smoke test of all four features end-to-end (tracking with no auto video → open
      reference section → rep counting → wrong-exercise mismatch banner → chatbot web fallback).
- [ ] Update `CLAUDE.md` "Current Progress" and `CLAUDE.local.md` checkboxes to reflect P11–P14.
- [ ] **Commit:** `[P14] docs: mark P11–P14 complete, update progress`
- [ ] Only now report completion. If any acceptance criterion failed, loop back and fix it before
      reporting — keep working until the goal is genuinely achieved.
```
```
