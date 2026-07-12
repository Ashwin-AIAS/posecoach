# P29 — Production Readiness: Error Surfacing, Vercel Deploy, Custom Exercises

> **DRAFT for review — reframeable.** Executable prompt for Claude Code. Run after
> P28 is merged (it is — `main` == `hf/main` @ e88d179). Read
> `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. Pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p29-production-readiness`
- **Depends on:** P23–P28 merged (done); HF Space live (verified: all
  `/api/v1/workouts/*` and `/api/v1/nutrition/*` endpoints serving)
- **New thesis metric:** none (product/deployment); SUS study becomes *unblocked*
  by this prompt — testers finally get a reachable URL.

---

## Why P29 exists (field-test findings, 2026-07-11)

Testing the installed PWA showed "Start workout" doing nothing, exercise selection
dead-ending, and Calories showing **"Failed to fetch"**. Root-cause audit:

1. **No public frontend exists.** The HF Space is API-only (`Dockerfile` never
   builds `frontend/`; `app/main.py` mounts no static files). The tested PWA was
   installed from the local vite origin; its service worker serves the shell
   offline, so the app *renders* with no backend behind it.
2. **The exercise library was a localStorage cache** (`pc.catalog.v1`) from an
   earlier session — an illusion of a live backend.
3. **Errors are swallowed.** `WorkoutPanel.tsx` `handleStartWorkout` /
   `handleExerciseSelect` have empty `catch` blocks ("For now silently fail").
   Only `DiaryDay` surfaces its error — hence "Failed to fetch" appearing only
   in Calories.
4. **Every workouts/nutrition route requires auth** (`get_current_user`), and the
   tester was not signed in. There is no sign-in prompt on 401 — buttons just die.
5. **Cross-origin blockers for a Vercel frontend:** `cookie_kwargs` hardcodes
   `samesite="lax"` (`app/auth/deps.py:35`) and `ALLOWED_ORIGINS` defaults to
   `http://localhost:5173` (`app/main.py:172`). Cookies will not flow from a
   Vercel origin until both are env-driven.
6. **Feature gap:** no custom exercises — no `POST /workouts/exercises`, no
   `is_custom`, no "add your own" in `ExercisePicker`.

---

## Open decisions — confirm or reframe before running

1. **Deploy target = Vercel** (user-confirmed). Frontend built with
   `VITE_API_URL=https://ashwintaibu-posecoach.hf.space`; Space env gets
   `ALLOWED_ORIGINS` incl. the Vercel domain and `COOKIE_SAMESITE=none`. OK?
2. **WebSocket note:** the Coach live flow connects to `wss://…hf.space/ws/…`
   cross-origin. WS is not subject to CORS but the token cookie must flow —
   `SameSite=None; Secure` covers it. Verify explicitly in Stage B gate. OK?
3. **Custom exercises live in the same `exercises` table** with nullable
   `owner_user_id` + `is_custom` (additive migration 0008), not a sibling table —
   so logging, sets, history, routines work unchanged. Catalog queries return
   seeded rows ∪ own rows. OK?

---

## Goal / Definition of Done

1. A tester with the Vercel URL can: register/sign in → start a workout → pick
   any exercise (or create a custom one by name) → log sets (weight × reps) →
   finish → see it in Recent workouts, **and** scan a barcode / search a food →
   log it → see daily totals. On a phone. No localhost anywhere.
2. Any failed action **tells the user why** (toast/inline): offline, signed-out
   (with a "Sign in" CTA deep-linking to Settings), or server error + Retry.
3. Custom exercise: "Can't find it? Add your own" in the picker → name (+ optional
   muscle group) → immediately usable and logged like any seeded exercise;
   persists in the user's catalog; never visible to other users.
4. Migrations 0006/0007/0008 applied on managed Postgres; seeded catalog verified
   (~873 rows) in prod.
5. All existing tests pass; new code tested; `ruff`/`mypy --strict`/`tsc`/eslint
   clean; pose core untouched.

---

## Stage A — Error surfacing + auth gating (frontend-only)

- New `useToast` (or minimal inline-error pattern matching house style — reuse
  `DiaryDay`'s error card) applied to: `handleStartWorkout`, `handleResume`,
  `handleExerciseSelect`, routine start, `AddFoodChooser` search, diary log.
- 401 detection in `apiJson` → typed `UnauthenticatedError`; panels render a
  "Sign in to track workouts" card with a button that switches to the Settings
  tab (same mechanism App uses for tab switching).
- Recent-workouts list: distinguish "no workouts yet" from "couldn't load" .
- **Gate:** vitest cases — signed-out click shows sign-in card; network-fail
  click shows error + retry; existing suites green; `tsc`/eslint clean.
- Commit: `[P29] feat: surface API errors + signed-out gating in Workouts/Calories`

## Stage B — Cross-origin auth + Vercel deploy

Backend (additive, no frozen files):
- `cookie_kwargs`: `samesite` from env `COOKIE_SAMESITE` (default `lax`),
  `secure` already env-driven; document `COOKIE_SAMESITE=none` requires
  `COOKIE_SECURE=true`.
- Confirm `ALLOWED_ORIGINS` env plumbed (it is) — set on the Space:
  `ALLOWED_ORIGINS=https://<app>.vercel.app,http://localhost:5173`.

Frontend/deploy:
- `frontend/vercel.json` (SPA rewrites); build env `VITE_API_URL`; ensure
  `api.ts` WS URL derivation uses `VITE_API_URL` host for `wss://`.
- Verify PWA manifest + service worker scope work on the Vercel origin; SW must
  **never cache `/api/`** responses (check existing workbox `urlPattern` — it
  currently targets `http://localhost:8000`, update pattern to the API host).
- **Gate (manual, from a phone):** register → start workout → log a set →
  finish; barcode scan → log food; live Coach WS session connects. Check
  `document.cookie` empty (httpOnly) and requests carry cookies (DevTools).
- Commit: `[P29] feat: env-driven SameSite + Vercel deploy config`

## Stage C — Custom exercises (full-stack, additive)

- Migration `0008_custom_exercises`: `exercises.owner_user_id` (nullable FK,
  indexed) + `exercises.is_custom` (bool default false). No existing row touched.
- `POST /api/v1/workouts/exercises` (auth): `{name, primary_muscle?, equipment?}`
  → creates `is_custom=true, owner_user_id=user.id`, slug = `custom-<uuid8>`;
  list/detail/history queries filter `owner_user_id IS NULL OR = user.id`.
  Custom rows excluded from other users; deletable only by owner (optional v1:
  no delete).
- Frontend: `ExercisePicker` + `ExerciseLibrary` empty-state row "Add custom
  exercise" → small sheet (name required) → POST → select immediately into the
  active workout. Badge "Custom" in rows. Catalog cache (`pc.catalog.v1`)
  invalidated on create.
- **Gate:** pytest — create/list/isolation-between-users/log-sets-against-custom;
  vitest — picker flow; migration up/down clean on SQLite + Postgres.
- Commit: `[P29] feat: user custom exercises (migration 0008 + API + picker UI)`

## Stage D — Prod data + deploy verification

- Run `alembic upgrade head` against managed Postgres (via Space startup or
  one-off); verify catalog seed count (~873) — if empty, run the P24.1 seed path.
- `git push hf main` (also flushes the pending history.py 500-fix noted in
  project memory); confirm Space rebuild; smoke-test the four openapi groups.
- **Gate:** `GET /api/v1/workouts/exercises?limit=1` returns 200 + a row for an
  authenticated user, from the Vercel origin, on a phone.
- Commit: `[P29] chore: prod migration/seed verification + deploy notes`

End with PR to `main`, then STOP.

---

## Guardrails specific to P29

- Frozen pose-core list untouched (roadmap §guardrails). Stage B touches
  `app/auth/deps.py` (cookie kwargs) and env docs only — auth logic unchanged.
- Additive only: migration 0008 adds columns; no existing table/row altered.
- No JWT in localStorage; cookies stay httpOnly. `COOKIE_SAMESITE=none` only
  with HTTPS. structlog only. Dark-only, English-only.
