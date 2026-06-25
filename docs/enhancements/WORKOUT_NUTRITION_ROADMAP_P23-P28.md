# PoseCoach — Workout & Nutrition Expansion (P23–P28)

> **Master roadmap.** This is the program-level plan that the per-prompt docs
> (starting with `NAV_TABS_AND_SETTINGS_P23.md`) execute against. Read this
> first. It defines the goal, the non-negotiable guardrails, the locked
> architecture decisions, and the order of work. Each prompt is independently
> shippable and ends with a push to GitHub.

---

## North-star goal

Grow PoseCoach from a single-purpose **form coach** into a four-tab fitness app
— **Coach · Workouts · Calories · Settings** — **without disturbing the
pose-estimation core in any way**. Every new capability lives in a new tab and is
purely additive. When the program is done:

- A persistent bottom **tab bar** switches between Coach, Workouts, Calories, Settings.
- **Coach** is the existing live form-coaching experience, byte-for-byte unchanged.
- **Workouts** is a premium gym logger (sets × reps × weight, routines, rest timer,
  progression charts) backed by an ~800-exercise public-domain library.
- **Calories** is a premium nutrition tracker (barcode scan → macros → daily diary
  with running totals) backed by Open Food Facts.
- **Settings** holds profile, account, and units — consolidating today's auth surface.

The differentiator that no competitor (Hevy, Strong, MyFitnessPal) can match:
because PoseCoach already counts reps and scores form per set, a logged set of a
CV-supported exercise can be **enriched with an auto rep-count and a form score**
straight from the live pipeline.

---

## Non-negotiable guardrails (the contract)

These apply to **every** prompt P23–P28. A change that violates any of them is a
defect, not a feature.

1. **The pose-estimation core is FROZEN.** New code may *read* finished session
   data through the API or *launch* the existing live flow unchanged — it must
   never import-and-modify, refactor, or alter the behavior of the CV path:
   - Backend: `app/api/v1/ws_inference.py`, `app/inference/**`,
     `app/analysis/**` (scorers, smoothers, `angle_ranges.json`, `adaptive.py`,
     `posing_progress.py`), the model/executor setup in `app/main.py` lifespan.
   - Frontend: `hooks/usePoseStream.ts`, `hooks/useWebSocket.ts`,
     `hooks/useCamera.ts`, `hooks/useSessionRecorder.ts`, `hooks/useSessionStats.ts`,
     `components/CameraFeed.tsx`, `components/CameraHud.tsx`,
     `components/PoseOverlay.tsx`, `components/CoachingCues.tsx`,
     `components/PosingPanel.tsx`, and `lib/poseRenderer.ts`, `lib/hudRenderer.ts`,
     `lib/skeleton.ts`, `lib/joints.ts`, `lib/poses.ts`, `lib/framing.ts`,
     `lib/poseInterpolator.ts`.
   - Shared UI primitives (e.g. `components/ScoreRing.tsx`, `ui/`) may be
     **imported and reused**, never modified in a breaking way.

2. **Additive only.** No existing database table is modified or migrated; new
   features get new tables. No existing component's behavior or markup is changed.
   The only existing file P23 edits is `App.tsx` (to host the tab bar), and even
   then the Coach branch's JSX is *wrapped*, not altered.

3. **The existing test suite is the regression gate.** `pytest` (backend) and
   `vitest` + `playwright` (frontend) must stay green at every stage. If an
   existing test changes behavior, stop — something in the core moved.

4. **Dark-only, English-only for now.** Theme switching (light mode) and i18n are
   explicitly **deferred** to their own later prompt, because both require editing
   every existing screen and would violate guardrail #2. Reuse the existing dark
   design tokens; do not introduce a new design system or UI kit.

5. **Every stage ends with a push to GitHub before the next begins.** See the
   git rule below. Do not start the next stage until the current one is committed,
   pushed, and all gates are green.

---

## Locked architecture decisions

Decided as a senior full-stack call, every choice chosen to fit existing patterns.

### Navigation
- **State-based tab bar, no router library** — matches the current `view`-state
  pattern in `App.tsx`. Tabs: `coach | workouts | calories | settings`.
- The tab bar **auto-hides during a live set** (`view === "live"`) and during an
  active workout-logging session, so the camera stays the hero (immersive pattern).
- New full-screen tabs mirror the **`HistoryPanel` / `PrepProgressPanel`** pattern
  (a `memo` component that owns its header and data fetching).

### Workout logger (P24–P26)
- **Additive, normalized data model.** New tables only; `WorkoutSession`
  (the CV form-scoring record) is **not** touched:
  - `exercises` — the ~800-row catalog (shared, not per-user).
  - `workout_logs` → `logged_exercises` → `logged_sets` (weight × reps × RPE).
  - `routines` / `routine_exercises` — reusable templates.
  - A `logged_sets` row carries an **optional** `form_score` + `source_session_id`
    that links to a CV `WorkoutSession` when the set was camera-tracked.
  - New Alembic migration `0006_workout_logger` — purely additive.
- **Exercise catalog = `free-exercise-db`** (public domain, ~800 exercises,
  static images). Seeded once via `scripts/seed_exercises.py`; images served from
  the jsDelivr CDN over the repo (zero hosting). The existing CV exercises keep
  their hand-curated, oEmbed-verified `youtubeId`s from `lib/exercises.ts`; the
  rest get a constructed YouTube search link, curated later.
- **Instant search** = bundle the catalog JSON (~1–2 MB text) for client-side
  filter with no spinner; backend stays source of truth. This is a core part of
  the "premium, not cheap" feel.
- **API** = new `app/workouts/` package + `app/api/v1/workouts.py` router,
  mirroring `history.py` exactly: prefix `/api/v1/workouts`, `get_current_user`
  dependency, async, structlog, every query filtered by `user_id` (IDOR rule).
- **Offline posture** = optimistic local state during an active workout (gym wifi
  is flaky), POST on set completion with retry. No full offline DB in v1.

### Calorie tracker (P27–P28)
- **Data source = Open Food Facts.** Free, open data (ODbL), **no API key** for
  reads; requires a custom `User-Agent` (`PoseCoach/1.0 (contact email)`).
  Rate limit **15 product reads/min/IP**, so **cache every lookup**. Data is
  crowd-sourced — show a small "community data" disclaimer.
- **Additive tables** = `food_items` (caches scanned products so repeat scans
  skip the API) + `food_log_entries` (the daily diary). New migration, additive.
- **Barcode scanning** = `@zxing/browser` (works on iOS Safari, where the native
  `BarcodeDetector` does not). Decoding happens **on-device**; only the decoded
  number leaves the phone — the "no frames off-device" privacy rule stays intact.
- **MVP scope (agreed)** = scan → see calories + macros → log to a daily diary
  with running totals (calories, protein, carbs, fat). A minimal "not found →
  type it in" fallback is included because Open Food Facts coverage is patchy on
  some regional products.

### Settings (P23)
- **Reuse** the existing auth surface: sign in / out and email come from
  `useAuth` + `AuthModal` (today's `UserMenu`); account deletion uses the existing
  `DELETE /auth/account` endpoint.
- **Units (kg/lb)** = a client-side preference (localStorage) via a small
  `useUnitPref` hook for now — no User-model change. The workout logger can
  migrate it server-side later if cross-device sync is wanted.

---

## Program sequence

Each row is its own prompt/doc and is independently shippable.

| Prompt | Scope | Backend? | Doc |
|--------|-------|----------|-----|
| **P23** | Navigation shell + **Settings** tab (Workouts/Calories are "coming soon" placeholders) | **No** (frontend-only) | `NAV_TABS_AND_SETTINGS_P23.md` |
| **P24** | Workout logger: data model + `workouts` API + catalog seed | Yes | _to be written_ |
| **P25** | Workout logger: logging UI (active workout, set rows, rest timer, plate calculator) | UI | _to be written_ |
| **P26** | Workout logger: progression (history, 1RM/volume charts) + routines + CV-set form-score wiring | Yes | _to be written_ |
| **P27** | Calorie tracker: OFF client + models + barcode scan + lookup | Yes | _to be written_ |
| **P28** | Calorie tracker: diary, daily totals, premium polish | UI | _to be written_ |
| _later_ | Theme (light mode) + i18n — their own isolated prompt | — | _deferred_ |

---

## The git rule (applies to every stage of every prompt)

> **Each stage ends with a commit and a push to GitHub. Do not move to the next
> stage until the push succeeds and all gates are green.**

```bash
# from repo root, on the prompt's feature branch
git add -A
git commit -m "[P2X] type: short description (<=72 chars)"   # type = feat|fix|test|docs|chore|refactor
git push origin <feature-branch>
```

- Push to **`origin`** (GitHub) only. The Hugging Face (`hf`) remote is the deploy
  target — do **not** push there per-stage; deploy when a prompt is fully merged.
- These stages touch only text/code (no `.pt`/`.onnx` LFS binaries), so a normal
  push is safe (no Git-LFS step needed).
- Gates that must pass before a push counts as "done": see each prompt's
  acceptance gates (lint, typecheck, tests).

---

## Definition of done (whole program)

- Four working tabs; **Coach is byte-for-byte the original experience**.
- Workouts and Calories deliver their agreed MVP scope at premium quality.
- Zero modification to any frozen pose-core file (verified by `git diff`).
- Every existing test still passes; new features ship with their own tests.
- Dark-only, English-only (theme + i18n consciously deferred).
- Every stage was pushed to GitHub before the next began.
