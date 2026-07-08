# P26 — Workout Logger: Progression + Routines UI + CV Form-Score Wiring

> **DRAFT for review — reframeable.** Executable prompt for Claude Code. Run it
> only after **P25** is merged (the Workouts tab logs real sets). Read
> `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. This prompt completes the workout
> logger: progression charts, the routines UI, and the program's differentiator —
> attaching a live CV form score + rep count to a logged set. Small backend
> additions (one link endpoint + routine delete); the pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p26-progression-cv-wiring`
- **Depends on:** P24 + P24.1 + P25 merged to `main`
- **Backend changes:** additive routes on the P24 `workouts` router only
- **New thesis metric:** none (product feature) — but the CV link showcases the
  thesis pipeline (rep counter + form scorer) inside a product flow

---

## Open decisions — confirm or reframe before running

1. **CV link is server-authoritative.** The new endpoint
   `POST /api/v1/workouts/sets/{set_id}/cv-link` takes only a `session_id`; the
   server verifies the caller owns **both** the set and the session, requires
   `session_type == "exercise"`, and copies `form_score` from the session's
   stored `avg_form_score`. The client never supplies a score. OK?
2. **Form-check flow** = in the active workout, a CV-supported exercise shows a
   "Form-check" button → the app switches to the Coach tab's live flow with that
   exercise preselected → the user does the set and taps "Finish set" → on
   closing the summary the app returns to the Workouts tab, fetches the newest
   history session, pre-fills a set row (reps from the CV rep count), and after
   the set is logged calls `cv-link`. The set row then shows a form-score badge. OK?
3. **Active-workout resume.** Switching to the Coach tab unmounts `WorkoutPanel`
   (App renders tabs conditionally), so the active workout id is persisted to
   `localStorage` (`pc.activeWorkout.v1`) and re-fetched via the existing
   `GET /workouts/{id}` on return. Side benefit: an accidental refresh/app
   restart offers "Resume workout" instead of losing the session. OK?
4. **Progression = client-side aggregation.** No new analytics endpoint: the
   existing `GET /exercises/{slug}/history` returns every set with est-1RM;
   the client groups by workout to chart **best est-1RM per session** and
   **volume per session**, plus a PR badge. Charts live in `ExerciseDetail`
   (a "Progress" section) and reuse the `PoseTrendChart`/`Sparkline` visual
   pattern. OK?
5. **Routines MVP scope** = save a finished workout as a routine (one tap on
   finish), list routines on the Workouts landing, start a workout from a
   routine (existing endpoint), delete a routine (new endpoint). A full drag-
   and-drop routine editor is deferred. OK?

If all five are fine as written, this prompt is ready to run after P25.

---

## Goal / Definition of Done

The workout logger is feature-complete for the roadmap. Done means **all** of:

1. **CV wiring:** a set logged after a form-check carries `form_score` +
   `source_session_id`, visible as a badge on the set row and in the workout
   detail. The link endpoint enforces ownership of both resources (404 on
   foreign ids) and rejects posing sessions (422).
2. **Progression:** `ExerciseDetail` shows a Progress section with a best-1RM
   trend, a volume-per-session trend, and the all-time PR; the Workouts landing's
   recent-workout rows tap into a read-only workout detail view.
3. **Routines:** finish-workout flow offers "Save as routine"; the landing lists
   routines with "Start" (uses `POST /workouts/from-routine/{id}`) and delete.
4. **Resume:** an in-progress workout survives tab switches and reloads via the
   persisted id + re-fetch ("Resume workout" on the landing when one is open).
5. Backend: `pytest` green with new tests for `cv-link` (happy path, both IDOR
   directions, posing rejection, detach) and routine delete (+ IDOR); coverage on
   `app/workouts` ≥ 80%; `ruff` + `mypy --strict` clean.
6. Frontend: `tsc`, `eslint`, `vitest`, `playwright` all green; new components
   ship with tests.
7. No frozen pose-core file changed. Existing files edited are **only**:
   `app/api/v1/workouts.py`, `app/workouts/schemas.py` (backend, P24-created),
   `frontend/src/App.tsx` (form-check launch/return wiring),
   `frontend/src/components/WorkoutPanel.tsx`, `ActiveWorkout.tsx`, `SetRow.tsx`,
   `ExerciseDetail.tsx`, `frontend/src/hooks/useWorkoutLog.ts`,
   `frontend/src/lib/workoutsApi.ts`, `frontend/src/types.ts` (P25-created).
   Each stage committed and **pushed to `origin`**.

---

## Guardrails specific to P26

- **The pose core stays frozen.** The form-check launch reuses the existing live
  flow by setting App-level state (`tab`, `view`, `exercise`) — exactly what the
  UI's own buttons do. No edit to `usePoseStream`, `useSessionStats`,
  `ws_inference.py`, or any frozen-list file. The session id comes from the
  existing history API **after** the set, never from the WS protocol.
- **No schema change.** `form_score` + `source_session_id` columns already exist
  (P24, migration 0006). No new migration in P26.
- **Server-authoritative score.** `cv-link` copies `avg_form_score` from the DB
  row; reject a `session_id` the caller does not own with **404** (same
  indistinguishability rule as the rest of the router).
- Follow code-style rules: absolute imports, `async def`, Google docstrings,
  `structlog`, typed everything; frontend strict TS, no `any`, Tailwind only.
- Reuse design tokens and existing primitives (`ScoreRing`, `Sparkline`,
  `PoseTrendChart` pattern, `Icon`). Dark-only, English-only.

---

## Per-stage git shorthand

Every stage ends with **Commit + push** on `feat/p26-progression-cv-wiring`:
```bash
git add -A
git commit -m "<the stage's message>"
git push origin feat/p26-progression-cv-wiring
```
**The next stage does not begin until that push succeeds and the stage's gate is green.**

---

## Stage 0 — Branch + baseline
**Goal:** green suite before changes.
```bash
git checkout -b feat/p26-progression-cv-wiring
ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 -q
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && cd ..
```
**Gate:** all pass. **Commit + push:** `[P26] chore: branch baseline for progression + CV wiring`.
> Do not proceed until pushed.

---

## Stage 1 — Backend: CV-link endpoint + routine delete
**Goal:** the two missing API pieces, additive on the P24 router.

**Tasks**
- `app/workouts/schemas.py` (additive):
  - `CvLinkRequest` — `session_id: str | None` (null = detach).
  - `CvLinkOut` — the updated `SetOut` **plus** `session_rep_count: int` (the
    CV rep count, so the UI can show "CV counted 8 reps" without a second call).
- `app/api/v1/workouts.py` (additive routes):
  - `POST /sets/{set_id}/cv-link` — load the set via the existing
    `_load_owned_set` (ownership by join); load the `WorkoutSession` filtered by
    `user_id == current_user.id` (foreign/missing → **404**); require
    `session_type == "exercise"` else **422**; set
    `source_session_id = session.id`, `form_score = session.avg_form_score`;
    on `session_id: null`, clear both. structlog either way.
  - `DELETE /routines/{routine_id}` → 204; ownership filter; ORM delete so the
    `routine_exercises` cascade fires (mirror `delete_workout`'s comment).

**Tests** (`tests/test_workouts_api.py` additions or a new
`tests/test_cv_link.py`): happy path copies the session's score; user A's set +
user B's session → 404; user B's set → 404; posing session → 422; detach clears
both fields; routine delete + IDOR (foreign routine → 404).

**Gate:** `pytest -x --timeout=30 --cov=app/workouts --cov-fail-under=80`,
`ruff check app/ --fix`, `mypy app/ --strict`.
**Commit + push:** `[P26] feat: CV-link endpoint + routine delete`. > Do not proceed until pushed.

---

## Stage 2 — Frontend: routines UI + workout detail + resume
**Goal:** routines end-to-end and the landing's tap-in detail; the active
workout survives leaving the tab.

**Tasks**
- `frontend/src/lib/workoutsApi.ts` (additive): `getWorkout(id)`,
  `listRoutines()`, `createRoutine(body)`, `deleteRoutine(id)`,
  `startFromRoutine(id)`, `cvLink(setId, sessionId)`.
- `frontend/src/types.ts` (additive): `RoutineOut`, `RoutineExerciseOut`,
  `CvLinkOut`.
- **Resume:** `WorkoutPanel` persists the active workout id to
  `localStorage["pc.activeWorkout.v1"]` on start and clears it on finish; on
  mount with a stored id, offer **Resume workout** on the landing (re-fetch via
  `getWorkout`, jump to the active-workout subview). `useWorkoutLog.setWorkout`
  already accepts a full `WorkoutLog`.
- **Routines:** new `frontend/src/components/RoutineList.tsx` — landing section
  listing routines (name, exercise count) with Start + delete (confirm);
  "Save as routine" prompt in the finish-workout flow (names it from the workout
  title; skips exercises with no catalog id — there are none today).
- **Workout detail:** new `frontend/src/components/WorkoutDetail.tsx` —
  read-only view of a past workout (`getWorkout`): exercises, sets, volume
  total, form-score badges where present. Recent-workout rows on the landing
  become tappable.

**Tests:** routine list renders + start calls API; save-as-routine posts ordered
exercise ids; resume restores the active subview from a stored id; workout
detail renders sets and a form-score badge.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P26] feat: routines UI, workout detail, resume workout`. > Do not proceed until pushed.

---

## Stage 3 — Frontend: progression charts
**Goal:** the Progress section in `ExerciseDetail`.

**Tasks**
- New `frontend/src/lib/progression.ts` — pure helpers (unit-tested): group
  `ExerciseHistoryOut.entries` by `workout_id` → per-session `{date, bestE1rm,
  volume}` series (chronological), plus the all-time PR entry.
- New `frontend/src/components/ProgressionChart.tsx` — best-1RM trend + volume
  bars over the last N sessions, following the `PoseTrendChart` SVG pattern
  (axis-free sparkline style, accent stroke, `hud-numerals` labels); respects
  `useUnitPref` for display.
- `frontend/src/components/ExerciseDetail.tsx` (edit, P25 file): add a
  "Progress" section that lazy-fetches `getExerciseHistory(slug)` when the
  detail opens and renders `ProgressionChart` + PR line ("Best: 100 kg × 5 —
  e1RM 116.7 kg"); hidden when there is no history.

**Tests:** `progression.ts` grouping/PR math on a fixture; chart renders points
for a multi-session fixture; unit preference converts displayed values.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P26] feat: per-exercise progression charts + PR`. > Do not proceed until pushed.

---

## Stage 4 — Frontend: CV form-check wiring
**Goal:** the differentiator — a live-scored set lands in the log.

**Tasks**
- New `frontend/src/lib/cvExercises.ts` — catalog-slug → CV `Exercise` map,
  mirroring `scripts/seed_exercises.py::CV_EXERCISE_MAP` (17 slugs), with a
  lookup helper `cvExerciseForSlug(slug): Exercise | null`.
- `frontend/src/App.tsx` (edit): a `pendingFormCheck` state
  `{ loggedExerciseId, cvExercise } | null`. `WorkoutPanel` gets an
  `onFormCheck(loggedExerciseId, cvExercise)` prop: App sets the pending target,
  sets `exercise`, switches `tab="coach"`, `view="live"`. In `closeSummary`,
  when a pending target exists: return to `tab="workouts"` (the panel resumes
  the persisted active workout) instead of restarting the camera. The Coach
  branch's JSX is not otherwise altered.
- `frontend/src/components/ActiveWorkout.tsx` (edit): CV-supported exercises
  (via `cvExerciseForSlug`) show a **Form-check** button that calls
  `onFormCheck`.
- Landing the score: on resume with a pending form-check, `WorkoutPanel`
  fetches `GET /api/v1/history/sessions?limit=1` (existing endpoint, add a tiny
  typed wrapper if none exists); if the newest session matches the pending CV
  exercise and started after the form-check began, it pre-fills a set row
  (reps = `rep_count`, weight empty) flagged "from Form-check"; when the user
  logs it, `useWorkoutLog` gains `linkSet(setId, sessionId)` → `cvLink` after
  the POST settles (never on the temp id). Mismatch or no session → plain set
  row, no link (fail open, no error state).
- `frontend/src/components/SetRow.tsx` (edit): when `form_score != null`,
  render a small score badge (color via the existing score color helper) with
  `title="Scored live by PoseCoach"`.

**Tests:** `cvExercises` map covers the 17 seeded slugs; form-check button
appears only for CV-supported rows; the flow links the newest matching session
(mocked API) and the badge renders; a non-matching session does not link.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P26] feat: CV form-check wiring — live score lands on the logged set`. > Do not proceed until pushed.

---

## Stage 5 — Polish, regression sweep + PR
**Goal:** premium feel; prove nothing in the core moved.
- A11y: all new controls ≥ 44px, labelled, focus-visible rings; charts get
  `role="img"` + `aria-label` summaries; reduced-motion respected.
- **Frozen-core proof:** `git diff --stat origin/main...feat/p26-progression-cv-wiring`
  — existing files changed are only the ones listed in Definition of Done §7.
- **Full regression:** backend `ruff check app/ && mypy app/ --strict &&
  pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`; frontend
  `npx tsc --noEmit && npx eslint src && npx vitest run && npx playwright test`.
**Commit + push:** `[P26] polish: a11y + regression sweep; verify pose core untouched`.
Then open a PR `[P26] Workout logger: progression, routines, CV form-score wiring`,
STOP. Do not start P27.

---

## Test plan summary

| Area | New tests | Must stay green |
|------|-----------|-----------------|
| cv-link API | ownership both ways, posing 422, detach, score copied | existing workouts API tests |
| Routines | delete + IDOR; UI list/start/save-as | from-routine tests |
| Progression | grouping/PR math, chart render, unit pref | — |
| Form-check flow | launch → return → link → badge; mismatch = no link | full vitest + playwright |
| Regression | — | pytest w/ analysis cov ≥80% |

---

## Out of scope for P26 (later)
- The calorie tracker (**P27–P28**).
- Routine editor (reorder/edit in place), routine folders.
- Server-side progression analytics endpoint (client-side aggregation is enough
  at current data volumes).
- Auto-detecting weight from the bar (no CV scope creep).
- Theme + i18n.
