# P24 — Workout Logger: Data Model + API + Exercise Catalog

> **DRAFT for review — reframeable.** Executable prompt for Claude Code, but do
> NOT run it until (a) P23 is merged and (b) you've confirmed/changed the
> **Open decisions** below. Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first for
> the program guardrails. This prompt is **backend-only**: new tables, a catalog
> seed, and the `workouts` API. No UI (that is P25). The pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p24-workout-logger-api`
- **Depends on:** P23 merged to `main`
- **New thesis metric:** none (product feature)

---

## Open decisions — confirm or reframe before running

1. **Catalog source** = `free-exercise-db` (public domain, ~800 exercises, static
   images via jsDelivr). Confirm, or swap to a paid GIF API.
2. **Catalog lives in a DB table** (`exercises`), seeded once and treated as source
   of truth; P25 bundles a JSON copy for instant client-side search. OK?
3. **Weight is stored canonically in kilograms**; lb is a *display* conversion done
   on the frontend (using P23's `useUnitPref`). Storage stays unit-agnostic. OK?
4. **RPE** (rate of perceived exertion, 1–10) is an **optional** column from day one. Keep?
5. **CV linkage columns** (`form_score`, `source_session_id`) are added to
   `logged_sets` now as **nullable**, but the wiring that fills them is **P26**. OK?

If all five are fine as written, this prompt is ready to run after P23.

---

## Goal / Definition of Done

The backend can store and serve a full gym log. Done means **all** of:

1. New, **additive** tables exist via Alembic `0006`: `exercises`, `workout_logs`,
   `logged_exercises`, `logged_sets`, `routines`, `routine_exercises`. The existing
   `WorkoutSession` table is **unchanged**.
2. `scripts/seed_exercises.py` populates `exercises` from free-exercise-db,
   idempotently, and marks the CV-supported lifts.
3. A `workouts` API (`/api/v1/workouts/...`) supports: browse/search the catalog,
   CRUD a workout, add exercises and sets, per-exercise history, and routines —
   every query scoped to `user_id`.
4. `pytest` (SQLite in-memory) covers models, the API, IDOR/ownership, and a
   deterministic 1RM helper; `ruff` and `mypy --strict` are clean; coverage on
   `app/workouts` ≥ 80%.
5. No frozen pose-core file changed; `app/main.py` gains **only** an
   `include_router` line. Every stage was committed and **pushed to `origin`**.

---

## Guardrails specific to P24

- **Additive schema only.** The migration `create_table`s new tables; it must not
  `alter`/`drop` any existing column or table. `WorkoutSession` is read-only here.
- **`app/main.py`** may be edited **only** to `app.include_router(workouts_router)`
  — do not touch the lifespan, model load, executor, or middleware.
- New models go in the flat `app/models.py` (project convention), new routes in a
  new `app/workouts/` package mirroring the `chatbot` package + `history.py` router.
- Follow code-style rules: absolute imports, `async def` routes, no bare except,
  Google docstrings, `structlog` (never `print`), constants UPPER_SNAKE_CASE.
- Every `workouts` query is filtered by `user_id == current_user.id` (IDOR rule,
  exactly as `history.py` documents).

---

## Per-stage git shorthand

Every stage below ends with **Commit + push**. That is shorthand for, on the
`feat/p24-workout-logger-api` branch:

```bash
git add -A
git commit -m "<the stage's message>"
git push origin feat/p24-workout-logger-api
```

**The next stage does not begin until that push succeeds and the stage's gate is green.**

---

## Stage 0 — Branch + baseline
**Goal:** green suite before changes.
```bash
git checkout -b feat/p24-workout-logger-api
ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 -q
```
**Gate:** all pass. **Commit + push (before Stage 1):**
```bash
git add -A && git commit -m "[P24] chore: branch baseline for workout-logger API"
git push origin feat/p24-workout-logger-api
```
> Do not proceed until this push succeeds.

---

## Stage 1 — Data model + migration
**Goal:** the additive tables.

**Tasks**
- Add to `app/models.py` (additive; `WorkoutSession` untouched):
  - `Exercise` — `id`, `slug` (unique), `name`, `category`, `equipment`,
    `primary_muscles` (JSON), `secondary_muscles` (JSON), `instructions` (JSON),
    `image_urls` (JSON), `youtube_id` (nullable), `is_cv_supported` (bool, default False).
    Catalog row; not per-user.
  - `WorkoutLog` — `id`, `user_id` (FK, indexed), `title`, `notes` (nullable),
    `started_at`, `ended_at` (nullable).
  - `LoggedExercise` — `id`, `workout_log_id` (FK, cascade), `exercise_id` (FK),
    `order` (int).
  - `LoggedSet` — `id`, `logged_exercise_id` (FK, cascade), `set_number`,
    `weight_kg` (Float, canonical), `reps` (int), `rpe` (Float, nullable),
    `is_warmup` (bool, default False), `completed` (bool, default True),
    `form_score` (Float, nullable), `source_session_id` (FK→workout_sessions.id,
    nullable, `ondelete=SET NULL`).  # CV link columns; filled in P26
  - `Routine` — `id`, `user_id` (FK, indexed), `name`, `created_at`.
  - `RoutineExercise` — `id`, `routine_id` (FK, cascade), `exercise_id` (FK), `order`.
- Alembic: `alembic revision -m "0006 workout logger"` → write `create_table`s only.
  Name it `alembic/versions/<ts>_0006_workout_logger.py`.

**Tests** (`tests/test_workout_models.py`): create a workout → exercises → sets;
cascade delete; `source_session_id` nullable + SET NULL behaviour.

**Gate:** `pytest tests/test_workout_models.py -v`, `mypy app/ --strict`, `ruff check app/`.
**Commit + push:** `[P24] feat: additive workout-logger tables + migration 0006` → push.
> Do not proceed until pushed.

---

## Stage 2 — Exercise catalog seed
**Goal:** populate `exercises` from free-exercise-db, idempotently.

**Tasks**
- `scripts/seed_exercises.py`:
  - Source JSON: `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json`.
  - Image URLs: prefix each image path with
    `https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/`.
  - Upsert by `slug` (idempotent — safe to re-run; skip/refresh existing).
  - Mark `is_cv_supported = True` for slugs matching the existing `Exercise` union
    in `frontend/src/types.ts` (squat, deadlift, curl, bench, ohp, lunge, plank,
    pushup, …). Keep a small alias map for name mismatches; carry over the curated
    `youtube_id`s from `frontend/src/lib/exercises.ts` for those.
  - Use `structlog`; print a summary count at the end.
- Document the run in the script header: `python -m scripts.seed_exercises`.

**Tests** (`tests/test_seed_exercises.py`): run the upsert against a **local JSON
fixture** (no network in tests); assert idempotency (second run = same row count)
and that a known CV slug is flagged.

**Gate:** seed test green; `ruff`/`mypy` clean.
**Commit + push:** `[P24] feat: free-exercise-db catalog seed (idempotent)` → push.
> Do not proceed until pushed.

---

## Stage 3 — Workouts API
**Goal:** the `/api/v1/workouts` router.

**Tasks**
- New package `app/workouts/`:
  - `schemas.py` — Pydantic request/response models (ExerciseOut, WorkoutCreate,
    WorkoutOut, SetCreate, SetOut, ExerciseHistoryOut, RoutineCreate, RoutineOut).
  - `service.py` — query helpers (catalog search, per-exercise history, 1RM via
    **Epley**: `1rm = w * (1 + reps/30)` — deterministic, unit-tested).
- New `app/api/v1/workouts.py` router (mirror `history.py`):
  `router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"])`,
  `get_current_user` dependency, async, structlog.
  - `GET /exercises?search=&muscle=&equipment=&limit=&offset=` — catalog browse.
  - `GET /exercises/{slug}` — detail.
  - `GET /exercises/{slug}/history` — this user's past sets + volume + best 1RM.
  - `GET /workouts?from=&to=` / `POST /workouts` / `PATCH /workouts/{id}` /
    `DELETE /workouts/{id}`.
  - `POST /workouts/{id}/exercises` — add an exercise to a workout.
  - `POST /logged-exercises/{id}/sets` / `PATCH /sets/{id}` / `DELETE /sets/{id}`.
  - `GET /routines` / `POST /routines` / `POST /workouts/from-routine/{routine_id}`.
- `app/main.py`: add `app.include_router(workouts_router)` (this one line only).

**Tests** (`tests/test_workouts_api.py`, SQLite in-memory): auth required;
create→add exercise→add set→read back; per-exercise history math; **IDOR** (user A
cannot read/modify user B's workout); 1RM helper unit test in
`tests/test_one_rep_max.py`.

**Gate:** `pytest -x --timeout=30 --cov=app/workouts --cov-fail-under=80`,
`ruff check app/ --fix`, `mypy app/ --strict`.
**Commit + push:** `[P24] feat: workouts API (catalog, logs, sets, routines)` → push.
> Do not proceed until pushed.

---

## Stage 4 — Quality sweep + PR
**Goal:** prove additivity and ship.
- Confirm `git diff --stat origin/main...feat/p24-workout-logger-api`: existing files
  changed are only `app/models.py` (additions) and `app/main.py` (one include line).
  No frozen-list file appears.
- Full regression: `ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`.
- **Commit + push (final):** `[P24] test: coverage + additivity verification` → push.
- Open PR `[P24] Workout logger: data model + API + catalog` (note: backend-only,
  additive, pose core untouched).

---

## Out of scope for P24 (later prompts)
- All UI — active workout screen, set rows, rest timer, plate calculator (**P25**).
- Progression charts + routines UI + CV form-score wiring (**P26**).
- The calorie tracker (**P27–P28**).
- Theme + i18n.
