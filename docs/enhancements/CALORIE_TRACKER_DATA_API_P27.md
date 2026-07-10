# P27 — Calorie Tracker: Data Model + Open Food Facts Client + Barcode Scan + Lookup

> **Executable prompt for Claude Code.** Run only after **P26** is merged. Read
> `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. This prompt delivers the first
> half of the calorie tracker: the additive nutrition schema, an Open Food Facts
> (OFF) client with a server-side cache, the full `/api/v1/nutrition` API
> (lookup, manual foods, diary CRUD + daily totals), and the on-device barcode
> scan → macros UI on the Calories tab. The **diary UI** (log from the product
> card, daily totals view, premium polish) is **P28**. The pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p27-calorie-tracker-api`
- **Depends on:** P26 merged to `main`
- **Backend changes:** additive — new tables (migration `0007`), new
  `app/nutrition/` package, new `app/api/v1/nutrition.py` router
- **New thesis metric:** none (product feature)

---

## Open decisions — decided as written (reframe by editing before running)

1. **Data source = Open Food Facts API v2** (`/api/v2/product/{barcode}`), no
   API key; custom User-Agent from env `OFF_USER_AGENT` (default
   `PoseCoach/1.0 (thesis project)`; prod should set a contact email per OFF
   policy). OFF's limit is **15 product reads/min/IP**, so every successful
   lookup is cached in `food_items` and repeat scans never hit the API.
2. **Two additive tables** via migration `0007_nutrition`:
   - `food_items` — shared product cache (`source="off"`, `created_by=NULL`)
     **plus** per-user manual entries (`source="manual"`, `created_by=user`).
     Manual foods are only visible to their creator; OFF rows are shared.
   - `food_log_entries` — the per-user diary. Macros are **snapshotted at log
     time** (server-computed from `amount_g` × per-100 g values) so a later OFF
     cache refresh never rewrites diary history.
3. **Cache policy** = cache-forever with a stored `fetched_at`; a TTL/refresh
   pass is deferred (nutrition facts change rarely; `fetched_at` makes a later
   refresh trivial).
4. **Our own rate limit** on the barcode lookup route:
   `NUTRITION_RATE_LIMIT = "10/minute"` via the shared slowapi limiter —
   protects the OFF quota from the server's single egress IP. The router file
   must **not** use `from __future__ import annotations` (known slowapi
   startup gotcha — see `app/api/v1/auth.py` note).
5. **Barcode scanning = `@zxing/browser`**, decoding **on-device**; only the
   decoded digits are sent to the backend. The scanner manages its own camera
   stream — the frozen `useCamera` hook is not touched. Barcodes are validated
   as 6–14 digits before lookup (EAN-8 → EAN-14/UPC).
6. **P27 UI scope** = Calories tab replaces "coming soon" with: scan → product
   card (kcal + protein/carbs/fat per 100 g and per serving when known) +
   "community data" disclaimer, and a minimal **manual-entry fallback** form
   for products OFF doesn't know. "Add to diary" + the diary view are **P28**.

---

## Goal / Definition of Done

1. Additive tables `food_items` + `food_log_entries` exist via Alembic `0007`;
   no existing table/column is altered.
2. `GET /api/v1/nutrition/products/{barcode}` is cache-first: first scan
   fetches from OFF (custom User-Agent, 10 s timeout) and caches; the second
   scan is served from the DB with **no network call**. Unknown barcode → 404;
   OFF unreachable → 503; malformed barcode → 422.
3. Manual foods: `POST /foods` (owner-scoped), `GET /foods/search` returns OFF
   rows + only the caller's manual rows.
4. Diary API: `POST /log`, `GET /log?date=` (entries + daily totals),
   `PATCH /log/{id}` (recomputes snapshot), `DELETE /log/{id}` — every query
   filtered by `user_id` (IDOR rule; foreign id → 404).
5. Frontend: Calories tab scans a barcode on-device and shows the macro card;
   not-found offers the manual form; camera stops on unmount/tab-hidden.
6. Gates: `pytest` green with `--cov=app/nutrition --cov-fail-under=80`;
   `ruff` + `mypy --strict` clean; frontend `tsc`, `eslint`, `vitest`,
   `playwright` green.
7. No frozen pose-core file changed. Existing files edited are **only**:
   `app/models.py` (additions), `app/main.py` (one `include_router` line),
   `app/rate_limit.py` (one constant), `.env.example` (one var),
   `frontend/src/App.tsx` (swap ComingSoon → CaloriesPanel on the calories
   branch), `frontend/src/types.ts` (additive types),
   `frontend/package.json` (+`@zxing/browser`/`@zxing/library`).
   Each stage committed and **pushed to `origin`**.

---

## Guardrails specific to P27

- **Privacy:** barcode decoding happens in the browser; no camera frame ever
  leaves the device. The backend receives only a numeric barcode string.
  Never log product images or user diary contents beyond ids/counts.
- **No frames to disk, ever** — the scanner uses a live `<video>` element only
  (`playsInline` for iOS Safari).
- **OFF is crowd-sourced** — show the small "community data" disclaimer on the
  product card (roadmap requirement).
- Mirror `workouts.py` router conventions: `get_current_user` everywhere,
  async, structlog, ownership by `user_id` filter, foreign id → 404.
- Follow code-style rules: absolute imports, Google docstrings, typed
  everything, constants UPPER_SNAKE_CASE; frontend strict TS, no `any`,
  Tailwind only, dark-only, English-only.
- Tests: SQLite in-memory; **`respx`** mocks all OFF HTTP calls — no network
  in tests.

---

## Per-stage git shorthand

Every stage ends with **Commit + push** on `feat/p27-calorie-tracker-api`:
```bash
git add -A
git commit -m "<the stage's message>"
git push origin feat/p27-calorie-tracker-api
```
**The next stage does not begin until that push succeeds and the gate is green.**

---

## Stage 0 — Branch + baseline
**Goal:** green suite before changes; the P27 doc lands with the branch.
```bash
git checkout -b feat/p27-calorie-tracker-api
ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 -q
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && cd ..
```
**Gate:** all pass. **Commit + push:** `[P27] chore: branch baseline for calorie tracker`.

---

## Stage 1 — Data model + migration 0007
**Goal:** the additive nutrition tables.

**Tasks**
- Add to `app/models.py` (additive; nothing existing touched):
  - `FoodItem` — `id`, `barcode` (nullable, unique, indexed — manual entries
    have none), `name`, `brand` (nullable), `serving_size_g` (Float, nullable),
    `serving_label` (nullable, e.g. `"1 bar (45 g)"`), `kcal_100g`,
    `protein_100g`, `carbs_100g`, `fat_100g` (Float, default 0.0),
    `image_url` (nullable), `source` (`"off" | "manual"`), `created_by`
    (FK→users.id, `ondelete=CASCADE`, nullable — set for manual foods so GDPR
    account deletion removes them), `fetched_at`, `created_at`.
  - `FoodLogEntry` — `id`, `user_id` (FK→users.id, `ondelete=CASCADE`,
    indexed), `food_item_id` (FK→food_items.id, `ondelete=CASCADE`),
    `logged_date` (Date, indexed), `meal` (default `"snack"`), `amount_g`
    (Float), snapshot columns `kcal`, `protein_g`, `carbs_g`, `fat_g` (Float),
    `created_at`. Relationship to `FoodItem` for responses.
- Alembic `alembic/versions/<ts>_0007_nutrition.py` — `create_table`s only.

**Tests** (`tests/test_nutrition_models.py`): create food + entries; user
delete cascades entries + their manual foods; food delete cascades entries;
OFF row with `created_by=NULL` survives user deletion.

**Gate:** `pytest tests/test_nutrition_models.py -v`, `mypy app/ --strict`, `ruff check app/`.
**Commit + push:** `[P27] feat: additive nutrition tables + migration 0007`.

---

## Stage 2 — OFF client + nutrition API
**Goal:** the `/api/v1/nutrition` router, cache-first.

**Tasks**
- New package `app/nutrition/`:
  - `off_client.py` — `async def fetch_product(barcode) -> OffProduct | None`.
    URL `https://world.openfoodfacts.org/api/v2/product/{barcode}` with a
    `fields=` param (name, brands, serving size/quantity, image, nutriments);
    parse `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`,
    `fat_100g`. `User-Agent` from `OFF_USER_AGENT`. 10 s timeout. `status: 0`
    or HTTP 404 → `None`; network error / 5xx → raise `OffUnavailableError`.
  - `schemas.py` — `FoodItemOut`, `ManualFoodCreate`, `LogEntryCreate`,
    `LogEntryUpdate`, `LogEntryOut`, `DailyLogOut` (entries + totals),
    `DailyTotals`.
  - `service.py` — `get_or_fetch_food(db, barcode)` (cache-first + upsert),
    `snapshot_macros(food, amount_g)` (pure, unit-tested), meal whitelist
    `MEALS = ("breakfast", "lunch", "dinner", "snack")`.
- New `app/api/v1/nutrition.py` (no `from __future__ import annotations`):
  - `GET /products/{barcode}` — `@limiter.limit(NUTRITION_RATE_LIMIT)`;
    barcode must match `^\d{6,14}$` else 422; cache → OFF → cache; 404 / 503
    as decided above.
  - `POST /foods` — manual food, `source="manual"`, `created_by=user`.
  - `GET /foods/search?q=&limit=` — OFF rows + caller's manual rows,
    name ILIKE.
  - `POST /log` / `GET /log?date=YYYY-MM-DD` / `PATCH /log/{id}` /
    `DELETE /log/{id}` — snapshot computed server-side; food must be visible
    to the caller (OFF or own manual) else 404; totals summed server-side.
- `app/rate_limit.py`: add `NUTRITION_RATE_LIMIT = "10/minute"`.
- `app/main.py`: `app.include_router(nutrition_router)` (one line).
- `.env.example`: add `OFF_USER_AGENT`.

**Tests** (`tests/test_off_client.py`, `tests/test_nutrition_api.py`, respx):
client parses a real-shaped OFF payload; `status:0` → None; 500/timeout →
`OffUnavailableError`; User-Agent header asserted. API: auth required; first
lookup hits mocked OFF once, second lookup makes **zero** further calls
(assert respx call_count); 404/422/503 paths; manual-food visibility (user B
cannot see/search/log user A's manual food → 404); snapshot math; totals;
PATCH recompute; IDOR on log entries both directions; delete 204/404.

**Gate:** `pytest -x --timeout=30 --cov=app/nutrition --cov-fail-under=80`,
`ruff check app/ --fix`, `mypy app/ --strict`.
**Commit + push:** `[P27] feat: nutrition API — OFF lookup w/ cache, manual foods, diary CRUD`.

---

## Stage 3 — Frontend: barcode scan + macro lookup
**Goal:** the Calories tab scans and shows macros.

**Tasks**
- `cd frontend && npm i @zxing/browser @zxing/library`.
- `frontend/src/lib/nutritionApi.ts` — typed wrappers (mirror
  `workoutsApi.ts`): `lookupBarcode`, `createManualFood`. (Diary wrappers
  arrive in P28 with the diary UI.)
- `frontend/src/types.ts` (additive): `FoodItemOut`.
- New `frontend/src/components/BarcodeScanner.tsx` — wraps
  `BrowserMultiFormatReader.decodeFromVideoDevice`; `playsInline muted`
  video; stops decoding + releases the stream on unmount and on
  `visibilitychange` hidden; calls `onDecoded(digits)` once per scan (dedupe
  repeat reads of the same code).
- New `frontend/src/components/CaloriesPanel.tsx` (memo, mirrors
  `WorkoutPanel` header pattern) — states: idle (hero + "Scan a barcode" +
  community-data disclaimer) → scanning → loading → product card / not-found
  (offers the manual form) / error (retry). Product card: name, brand, image
  (if any), kcal headline, protein/carbs/fat rows per 100 g + per serving
  when `serving_size_g` is known. All controls ≥ 44 px, focus-visible rings.
- New `frontend/src/components/ManualFoodForm.tsx` — name + kcal/100 g +
  macro fields (+ optional serving), posts `createManualFood`, then renders
  the same product card.
- `frontend/src/App.tsx`: swap the calories branch's `ComingSoon` for
  `CaloriesPanel` (the only App edit). Check for e2e/vitest assertions on the
  old placeholder text and update **only those assertions** if any exist.

**Tests:** nutritionApi wrappers (mocked fetch, error mapping); CaloriesPanel
state machine with a mocked scanner module + mocked API (found / not-found →
manual form / OFF-down error); scanner cleanup on unmount (mock zxing).

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P27] feat: Calories tab — on-device barcode scan + macro lookup`.

---

## Stage 4 — Regression sweep + PR
**Goal:** prove nothing in the core moved; ship.
- **Frozen-core proof:** `git diff --stat origin/main...feat/p27-calorie-tracker-api`
  — existing files changed are only the ones in Definition of Done §7.
- **Full regression:** backend `ruff check app/ && mypy app/ --strict &&
  pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`; frontend
  `npx tsc --noEmit && npx eslint src && npx vitest run && npx playwright test`.
**Commit + push:** `[P27] polish: regression sweep; verify pose core untouched`.
Then open a PR `[P27] Calorie tracker: OFF client + models + barcode scan + lookup`,
**STOP**. Do not start P28.

---

## Out of scope for P27 (P28 or later)
- Logging a scanned product to the diary from the UI; the diary view; daily
  running totals UI; meal grouping UI (**P28**).
- OFF full-text product search (local cache search only for now).
- Cache TTL/refresh pass; nutrition goals; streaks.
- Theme + i18n.
