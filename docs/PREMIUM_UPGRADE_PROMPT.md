# PoseCoach — Premium Upgrade Implementation Brief

> Hand this file to your coding agent. It is grounded in the real codebase
> (`app/analysis/form_scorer.py`, `frontend/src/types.ts`, `app/analysis/angle_ranges.json`)
> and the rules in `CLAUDE.md` + `.claude/rules/`. Execute top-to-bottom.

---

## ROLE — operate as a cross-functional product team

Think and act as four experts working together, not one coder:

- **CV/Pose engineer** — owns how keypoints flow from YOLO26 into angles. Knows the model is `nc=1` (person-only) and does **not** classify exercises, so adding exercises is a *scoring + UI* job, never a retraining job. Never touches the model, dataset, or `end2end` flag for this work.
- **ML/biomechanics engineer** — owns `form_scorer.py` and `angle_ranges.json`. Refuses to expose any exercise whose joint ranges aren't validated against real Fit3D data. Treats "a button that returns score 0" as a bug.
- **Product designer** — owns the premium dark athletic-tech feel, information hierarchy, motion, and the "how-to" learning layer. Obsessed with the first 5 seconds of the experience.
- **Frontend engineer** — owns React/TS/Tailwind quality, performance (camera must never drop below 15 FPS), accessibility, and PWA installability.

### Operating principles (non-negotiable)

1. **Validate data before exposing UI.** No exercise reaches the dropdown until its scorer path is proven end-to-end (data key → joints → cues → test).
2. **Every feature maps to a thesis metric** (form-score consistency, latency p95, rep-count accuracy, chatbot accuracy, SUS). If it can't be measured or written about, it's polish — label it as such, keep it optional.
3. **Respect existing architecture rules** in `CLAUDE.md` and `.claude/rules/` — do not relitigate them. Key ones below.
4. **Small, reversible commits** using the `[P0X] type: desc` format. One concern per commit.
5. **Verify, don't assume.** Run the quality gate after each task. Read the actual file before editing it.

### Hard rules you must not break (from project memory)

- YOLO26: never pass `end2end=False`; keypoints via `results[0].keypoints.xyn`; model loaded once in lifespan; inference in executor. **Do not modify any of this for this work.**
- Scorer must be **deterministic** (same input → same output, <5% variance). Cues ≤ 8 words, plain English.
- Logging: `structlog` only — never `print()` / `logging.getLogger()`. Never log frames, keypoints, tokens, or PII.
- Auth/privacy: JWT in `httpOnly` cookies, **never** localStorage/sessionStorage. Frames stay in memory.
- Frontend: **Tailwind utility classes only**, no inline styles except truly dynamic values. No `any` in TS. `requestAnimationFrame`, max 15 FPS, `playsInline` on `<video>`.
- Tests: SQLite in-memory, `asyncio_mode=auto`. Quality gate must pass:
  `ruff check app/ --fix`, `mypy app/ --strict`, `pytest -x --cov=app/analysis --cov-fail-under=80`, and `npx vitest run`.

---

## TASK 1 — Expand 7 → ~15 *functional* exercises

**Current truth:** `SUPPORTED_EXERCISES` in `app/analysis/form_scorer.py` = 7. Frontend `EXERCISES` in `frontend/src/types.ts` = the same 7. `angle_ranges.json` holds 47 keys but most are `warmup_*` with no joint map or cues. Your job is to wire a curated set where **each new exercise is biomechanically real**, not to dump all 47.

### Candidate set to wire (validate each before accepting)

Keep the existing 7 (`squat, deadlift, curl, bench, ohp, lunge, plank`). Add these by mapping to existing `angle_ranges.json` keys:

| UI name | `angle_ranges.json` key | Primary joints to score | Category |
|---|---|---|---|
| `pushup` | `pushup` | left/right elbow, shoulder | Push |
| `hammer_curl` | `dumbbell_hammer_curls` | left/right elbow | Arms |
| `lateral_raise` | `side_lateral_raise` | left/right shoulder | Shoulders |
| `barbell_row` | `barbell_row` | left/right hip, elbow | Pull |
| `db_shoulder_press` | `dumbbell_overhead_shoulder_press` | left/right elbow, shoulder | Shoulders |
| `diamond_pushup` | `diamond_pushup` | left/right elbow, shoulder | Push |
| `drag_curl` | `drag_curl` | left/right elbow | Arms |
| `one_arm_row` | `one_arm_row` | elbow, hip | Pull |

### Validation procedure (ML-engineer gate) — run for EACH candidate

For the mapped key, confirm in `angle_ranges.json`:

1. Every joint you intend to score has a `p5` and `p95`.
2. Ranges are physiologically plausible (elbow/knee within ~0–180°, no degenerate `p5 ≈ p95` collapse — that signals a static/warmup pose, **reject it**).
3. `n_frames` is reasonable (not a tiny sample).

If a candidate fails, **drop it or swap** for another real key from the 47 (e.g. `band_pull_apart`, `barbell_shrug`) — do not ship a broken one. Land **~15 total**.

### Wiring steps (each exercise, end-to-end)

**Backend** (`app/analysis/form_scorer.py`):

- Add name to `SUPPORTED_EXERCISES`.
- Add entry to `_EXERCISE_DATA_KEY` (UI name → Fit3D key).
- Add entry to `_EXERCISE_JOINTS` (the validated joints).
- Add an entry to `_CUES` for each joint × {low, high}, ≤ 8 words, plain English.

**Frontend** (`frontend/src/types.ts`):

- Extend the `Exercise` union and the `EXERCISES` array.

**Metadata (new file)** `frontend/src/lib/exercises.ts` — single source of truth the UI reads:

```ts
export interface ExerciseMeta {
  readonly id: Exercise
  readonly label: string          // "Hammer Curl"
  readonly category: "Push" | "Pull" | "Legs" | "Arms" | "Shoulders" | "Core"
  readonly primaryMuscles: readonly string[]
  readonly youtubeId: string      // see Task 3
  readonly difficulty: "Beginner" | "Intermediate" | "Advanced"
}
```

**Tests** (`tests/test_form_scorer.py`): every supported exercise returns a valid `FormResult` (score 0–100, cues present when sub-optimal). Extend `tests/test_form_consistency.py` so the <5% variance check covers the new set. Update `frontend/src/__tests__/ExerciseSelector.test.tsx`.

**Thesis mapping:** each new exercise rides the existing *form-score consistency* and *latency* metrics — no new metric needed, but note the expanded coverage in the eval write-up.

> Reassurance to the CV engineer: because the model is `nc=1`, **no retraining, no dataset change, no Colab run** is required. This is purely scorer + UI.

---

## TASK 2 — Premium "dark athletic-tech" redesign

Target feel: Whoop / Apple Fitness — deep charcoal, one electric accent, glass cards, confident typography, purposeful motion. Stay Tailwind-only.

### Design tokens — extend `tailwind.config`, don't inline

- **Surfaces:** near-black base `#0A0B0D`, raised card `#15171C`, hairline borders `#23262D`.
- **Accent:** one electric color (recommend lime `#C8FF3D` or electric-blue `#3D9BFF`) for active states, score ring, CTAs. Use sparingly.
- **Score semantics:** red→amber→lime gradient driven by the live form score.
- **Type:** a bold display face for numbers/headlines (e.g. Inter Tight / Space Grotesk via fontsource), regular Inter for body. Numbers should feel like a HUD.
- **Glass:** `backdrop-blur` + low-opacity surface + hairline border for floating panels.

### Screen-by-screen

- **App shell** (`App.tsx`): replace the plain header. Left: PoseCoach wordmark + live latency badge (proves the <100ms thesis metric on screen). Right: user menu. Camera becomes a cinematic full-bleed stage; side panel becomes a glass column.
- **Exercise selection** (replace the pill row): a **categorized grid of cards** (grouped by category from `exercises.ts`) — each card shows icon, name, difficulty, and a small "?" that opens the how-to demo (Task 3). Active card glows in the accent. Searchable/filterable since there are now ~15. Collapses into a horizontal scroll on mobile.
- **Camera HUD** (`PoseOverlay`/`CoachingCues`): a circular **form-score ring** (animated, color-driven by score) in a corner, large rep counter, and the top coaching cue rendered as a clean lower-third caption that fades in/out. Style the skeleton overlay with the accent + soft glow rather than raw lines.
- **Coaching panel:** glass card, animated score, per-joint mini-bars, cue list with subtle enter/exit transitions.
- **Chat panel:** premium chat styling, typing indicator, message bubbles consistent with the system.
- **States:** design real empty / loading / camera-denied / disconnected states — premium apps never show a blank box.

### Motion & perf

- Prefer CSS/Tailwind `transition` / `animate-*`. Only add `framer-motion` if a transition genuinely needs it (keep deps lean).
- Motion must **never** compete with the camera loop — animate UI chrome, not the video frame path. Respect `prefers-reduced-motion`.

### Accessibility & PWA

- Maintain `role` / `aria` on the new selector (it currently uses `radiogroup`). Keyboard-navigable cards, visible focus rings, AA contrast.
- Polish `manifest.json` + icons so it installs cleanly on mobile; add an install prompt.

---

## TASK 3 — Curated, embedded "How-to" video per exercise

For **every** exercise, a hand-picked demo, loaded only on demand.

- Store **one curated `youtubeId` per exercise** in `frontend/src/lib/exercises.ts` (Task 1). Curate from reputable form-coaching channels; verify each link actually demonstrates that lift. IDs live in config, never hardcoded inside components.
- Build a `HowToDrawer` / modal that opens from the "?" on each exercise card and from an info button on the camera HUD.
- **Privacy + performance:** use a **lite-embed facade** — render the YouTube thumbnail first; only inject the `<iframe>` (pointed at `https://www.youtube-nocookie.com/embed/<id>`) on click. No autoplay. This protects camera FPS and respects the project's privacy posture (no third-party cookies until the user opts in).
- The drawer also shows the exercise's coaching cues and primary muscles, so it doubles as a learning surface (supports the user-study / SUS metric).
- Add a `frontend/src/__tests__` case asserting every `Exercise` has a non-empty `youtubeId` (no exercise ships without a demo).

> If you later want always-fresh results instead of curated IDs, that requires a YouTube Data API key + quota handling — out of scope here; curated embeds are the premium-but-reliable choice.

---

## TASK 4 — Premium features (ranked; each tagged to a metric)

Implement in this order; stop where time runs out:

1. **Live form-score ring + color** — *form-score consistency metric.* Highest visual ROI.
2. **Rep counter HUD** surfaced from `rep_counter.py` — *rep-count accuracy ≥90% metric.*
3. **Live latency badge** in the header — *latency p95 <100ms metric*, and a great defense-demo flex.
4. **Session summary** on stop: avg score, reps, best set, trend sparkline from `WorkoutSession` history — *uses existing history; supports SUS.*
5. **Voice coaching cues (TTS)** — optional, hands-free; pure UX polish (label as such).
6. **Onboarding + empty/loading/error states** — *SUS / user-study metric.*
7. **PWA install polish + offline shell** — installability.

---

## EXECUTION PROTOCOL

- Order: **Task 1 → Task 3 metadata → Task 2 → Task 4.** (Wire data first so the UI has real content to render.)
- After each task run the full quality gate (ruff, mypy --strict, pytest cov≥80, vitest). Fix before moving on.
- Commit per concern: `[P0X] feat: ...`, `[P0X] refactor: ...`.
- **Definition of done:** every exercise in the UI returns a real score + cue; every exercise has a working demo; gate is green; camera holds ≥15 FPS with the new UI; no localStorage, no `print`, no `any`, no inline styles.
- **Final verification step:** start the stack, exercise all ~15 in the browser, confirm none return score 0 / "Unknown exercise," screenshot the redesigned UI, and confirm the latency badge stays <100ms p95.
