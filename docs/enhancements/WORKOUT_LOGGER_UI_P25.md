# P25 — Workout Logger: UI (Browse + Active Workout + Set Logging)

> **DRAFT for review — reframeable.** Executable prompt for Claude Code. Run it
> only after **P24** and **P24.1** are merged (the `/api/v1/workouts` API is live
> and the exercise catalog is seeded). Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md`
> first. This prompt is **frontend-only**: it fills the **Workouts** tab (today a
> "Coming soon" placeholder) with the real logging experience. No backend change.
> Pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p25-workout-logger-ui`
- **Depends on:** P24 + P24.1 merged; catalog populated (`/workouts/exercises` returns ~870)
- **Backend changes:** none (consumes the existing P24 API)
- **New thesis metric:** none (product feature)

---

## Open decisions — confirm or reframe before running

1. **Instant search** = on first open of the Workouts tab, fetch the full
   lightweight catalog once (id, name, category, equipment, primary muscles, image
   URL, `is_cv_supported`), cache it (memory + localStorage with a version key), and
   filter/search **client-side** for zero-latency UX. (No build-time bundle.) NOTE: the catalog API paginates at <=200/page, so the hook pages through all results once (loop limit=200 until exhausted) to assemble the full ~873-row set. OK?
2. **P25 scope = the core logging loop only.** Routines UI, 1RM/volume progression
   charts, and the CV "Form-check" wiring are **P26**. P25 ships: exercise browser,
   active workout, set logging, rest timer, plate calculator, and a simple recent-
   workouts list. OK?
3. **Units** come from P23's `useUnitPref` (kg/lb) — weights are entered/displayed in
   the user's unit, converted to canonical kg before POST. OK?

If all three are fine, this prompt is ready to run after P24/P24.1.

---

## Goal / Definition of Done

The **Workouts** tab is a working gym logger. Done means **all** of:

1. Workouts tab landing shows a "Start workout" CTA, a recent-workouts list, and an
   entry into the exercise library (the P23 `ComingSoon` placeholder is gone).
2. **Exercise library:** search + filter (muscle/equipment) over the seeded catalog
   with instant client-side results; each row shows an image (lazy-loaded from CDN);
   a detail view shows images, instructions, a YouTube demo (existing lite-embed
   pattern), and a "Form-check available" badge when `is_cv_supported`.
3. **Active workout:** start a workout, add exercises, log sets (weight × reps ×
   optional RPE) with a "last time" reference, mark sets complete, finish the workout.
   A **rest timer** (built from `ScoreRing`) and a **plate calculator** are available.
4. Logging is optimistic (works through flaky gym wifi): UI updates immediately,
   POSTs on set completion, retries on failure.
5. Weights honor `useUnitPref` (kg/lb), stored canonical kg.
6. Every existing test still passes; new components/hooks ship with tests; `tsc` and
   `eslint` clean.
7. No frozen pose-core file changed; the only existing file edited is
   `frontend/src/App.tsx` (swap the Workouts placeholder for `WorkoutPanel`). Each
   stage committed and **pushed to `origin`**.

---

## Guardrails specific to P25

- **Frontend-only.** No backend, schema, or API change — consume the P24 endpoints.
- The **only existing file** edited is `frontend/src/App.tsx` (one line: Workouts tab
  renders `<WorkoutPanel/>` instead of `<ComingSoon/>`). Everything else is new files.
- Never touch the frozen pose-core list (roadmap §guardrails). Reuse design tokens
  (`surface-*`, `accent`, `font-display`, `ease-spring`, `shadow-elev-*`), the `Icon`
  primitive, and `ScoreRing`/`Sparkline`. No new UI kit, no inline styles except
  dynamic values. Dark-only, English-only.
- Mirror the `HistoryPanel`/`PrepProgressPanel` pattern for `WorkoutPanel` (memoized,
  owns its header + data fetching).

---

## Per-stage git shorthand

Every stage ends with **Commit + push** on `feat/p25-workout-logger-ui`:
```bash
git add -A
git commit -m "<the stage's message>"
git push origin feat/p25-workout-logger-ui
```
**The next stage does not begin until that push succeeds and the stage's gate is green.**

---

## Stage 0 — Branch + baseline
**Goal:** green suite before changes.
```bash
git checkout -b feat/p25-workout-logger-ui
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && cd ..
```
**Gate:** all pass. **Commit + push:** `[P25] chore: branch baseline for workout-logger UI`.
> Do not proceed until pushed.

---

## Stage 1 — API client + types + data hooks
**Goal:** typed access to the P24 API, plus the instant-search catalog cache.

**New files**
- `frontend/src/lib/workoutsApi.ts` — typed wrappers (using `apiFetch`/`apiJson`):
  catalog `listExercises(params)` / `getExercise(slug)` / `getExerciseHistory(slug)`;
  workouts `listWorkouts(range)` / `createWorkout()` / `updateWorkout(id)` /
  `deleteWorkout(id)`; `addExercise(workoutId, slug)`; sets `addSet(loggedExerciseId,
  body)` / `updateSet(id, body)` / `deleteSet(id)`.
- `frontend/src/types.ts` → add additive interfaces `ExerciseSummary`,
  `ExerciseDetail`, `WorkoutLog`, `LoggedExercise`, `LoggedSet` (read-only props).
  (Additive types only — do not change existing exports.)
- `frontend/src/hooks/useExerciseCatalog.ts` — fetch ALL catalog pages once (loop limit=200 until exhausted) + cache (memory +
  `localStorage` key `pc.catalog.v1`), expose `{ all, search(q,filters), loading }`
  with client-side filtering.
- `frontend/src/hooks/useWorkoutLog.ts` — active-workout state, optimistic
  add/update set, POST-on-complete with retry/backoff.
- `frontend/src/lib/oneRepMax.ts` — Epley display helper `1rm = w*(1+reps/30)` (the
  number shown next to a set); deterministic, unit-tested.

**Tests:** `useExerciseCatalog` (search/filter on a fixture, cache hit), `workoutsApi`
(mock fetch), `oneRepMax` (known values).

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P25] feat: workouts API client + catalog/log hooks`. > Do not proceed until pushed.

---

## Stage 2 — Workouts tab + exercise library
**Goal:** the tab landing and the browse/search/detail flow.

**New files**
- `frontend/src/components/WorkoutPanel.tsx` — tab root (mirror `HistoryPanel`):
  landing with a "Start workout" CTA, a recent-workouts list (from `listWorkouts`),
  and a "Browse exercises" entry.
- `frontend/src/components/ExerciseLibrary.tsx` — search box + muscle/equipment
  filter chips + virtualized/lazy list; images lazy-load from the CDN URL.
- `frontend/src/components/ExerciseDetail.tsx` — image(s), instructions, a YouTube
  demo via the existing lite-embed pattern (see `lib/exercises.ts` / `HowToDrawer`),
  and a "Form-check available" badge when `is_cv_supported` (display only; the launch
  + form-score wiring is P26).

**Edit (only existing file):** `frontend/src/App.tsx` — Workouts tab renders
`<WorkoutPanel/>` instead of the `ComingSoon` placeholder.

**Tests:** library search/filter renders expected rows; detail shows CV badge for a
CV-supported slug; tab swaps from placeholder to panel.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P25] feat: Workouts tab + exercise library browse/search/detail`. > Do not proceed until pushed.

---

## Stage 3 — Active workout + set logging
**Goal:** the core logging loop.

**New files**
- `frontend/src/components/ActiveWorkout.tsx` — start/resume a workout; list added
  exercises; add-exercise picker; finish workout.
- `frontend/src/components/ExercisePicker.tsx` — modal to add a catalog exercise to
  the active workout.
- `frontend/src/components/SetRow.tsx` — weight (in `useUnitPref` unit) + reps +
  optional RPE inputs; a "last time: 80kg × 8" hint from `getExerciseHistory`; a
  complete toggle; estimated 1RM via `oneRepMax`.
- `frontend/src/components/RestTimer.tsx` — countdown built from `ScoreRing`;
  optional auto-start after a completed set.
- `frontend/src/components/PlateCalculator.tsx` — given target weight + bar weight,
  show plates per side.

**Behavior:** optimistic local state via `useWorkoutLog`; POST on set completion;
retry with backoff; convert entered weight → canonical kg before POST.

**Tests:** add exercise → log a set → optimistic render → POST called with kg;
RPE optional; rest timer counts down; plate calculator math.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P25] feat: active workout, set logging, rest timer, plate calc`. > Do not proceed until pushed.

---

## Stage 4 — Polish, a11y, regression sweep + PR
**Goal:** premium feel; prove nothing in the core moved.
- A11y: inputs labelled; numeric keypads (`inputMode="decimal"`); focus rings use
  `accent`; hit targets ≥ 44px; rest timer respects `prefers-reduced-motion`.
- Tab bar stays hidden during an active workout (immersive), like a live set.
- **Frozen-core proof:** `git diff --stat origin/main...feat/p25-workout-logger-ui` —
  the only existing file is `frontend/src/App.tsx`.
- **Full regression:** `npx tsc --noEmit && npx eslint src && npx vitest run && npx playwright test`.
**Commit + push:** `[P25] polish: a11y, immersive tab bar; verify pose core untouched`.
Then open a PR `[P25] Workout logger UI`, STOP. Do not start P26.

---

## Test plan summary

| Area | New tests | Must stay green |
|------|-----------|-----------------|
| Catalog/hooks | search/filter, cache, 1RM | — |
| Library/detail | rows render, CV badge | — |
| Active workout | log set → optimistic → POST kg; RPE optional | — |
| Rest timer / plates | countdown, plate math | — |
| Regression | — | full vitest + playwright |

---

## Out of scope for P25 (these are P26)
- Routines / templates UI (save "Push Day", start from routine).
- Progression: 1RM/volume charts, PR history (reuse `PoseTrendChart`/`Sparkline`).
- CV "Form-check" wiring: launch the live flow from a CV-supported set and attach the
  resulting form score + `source_session_id` to that `logged_set`.
- The calorie tracker (P27–P28); theme + i18n.
