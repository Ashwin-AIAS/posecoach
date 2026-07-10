# P28 — Calorie Tracker: Diary UI, Daily Totals, Premium Polish

> **Executable prompt for Claude Code.** Run only after **P27** is merged. Read
> `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first, then this doc. This prompt
> delivers the **second half** of the calorie tracker: the daily diary that the
> P27 backend already serves. All diary endpoints exist and are tested
> (`POST/GET/PATCH/DELETE /api/v1/nutrition/log`); P28 is **frontend-only** — it
> wires the finished API into a premium, day-based food diary with running
> totals. The pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p28-calorie-diary-ui`
- **Depends on:** P27 merged to `main` (PR #7) + the TLS fix (PR #8)
- **Backend changes:** **none.** The `/api/v1/nutrition` diary API is complete.
- **New thesis metric:** none (product feature)

---

## Open decisions — decided as written (reframe by editing before running)

1. **The Calories tab home becomes the diary, not the scanner.** In P27 the tab
   landed on the scan hero. In P28 the tab's default view is **today's diary**
   (totals + meal-grouped entries); adding food (scan / search / manual) is an
   action launched from the diary, not the landing screen. This is the expected
   P28 evolution and is confined to `CaloriesPanel.tsx` (a P27-new component, not
   frozen). Any P27 vitest/e2e assertion that expected the idle scan-hero *as the
   tab landing* is updated — **only** those assertions, and only to reflect the
   new home. The scan → macro-card → manual-fallback machine from P27 is reused
   intact, now reached via "Add food".

2. **"Add to diary" collects meal + amount with a live macro preview.** From any
   macro card (scanned, searched, or manual) the user picks a **meal**
   (`breakfast | lunch | dinner | snack`) and an **amount in grams** (defaulting
   to `serving_size_g` when the food has one, else `100 g`). The sheet shows the
   computed kcal/P/C/F for that amount **before** logging — the same server-side
   snapshot math (`amount_g × per-100 g / 100`), mirrored client-side for preview
   only. The server remains the source of truth; the POST response replaces the
   optimistic row.

3. **Re-log without rescanning via search.** The tab exposes `GET /foods/search`
   (already shipped, already flagged "used by P28's diary") so a user can add a
   previously-scanned or manual food by typing its name — no barcode needed. This
   is the everyday path (you scan a product once; after that you search it). Scan
   stays the discovery path for new products.

4. **Day navigation, no calendar widget.** A compact date header with
   `‹ prev · Today · next ›` and the weekday/date label. "Today" is disabled when
   already on today; you cannot page into the future past today (a diary is a
   record, not a planner). No third-party date picker — a tiny pure `lib/day.ts`
   (`todayISO`, `addDays`, `formatDayLabel`, `isToday`) since the app has no
   date-nav helper yet. Dates are handled as `YYYY-MM-DD` strings in **local**
   time to match how a user experiences "today"; `logged_date` is a `date`, never
   a timestamp, so there is no timezone drift.

5. **Optimistic add and delete, with rollback.** Gym/kitchen wifi is flaky (same
   posture as the workout logger). Logging appends the row and bumps totals
   immediately; a failed POST removes it and surfaces the error. Delete removes
   the row immediately with a brief **Undo** affordance; if the DELETE fails the
   row returns. Edits (amount/meal) are committed on save and reconciled from the
   PATCH response.

6. **Totals presentation = calorie headline + macro split.** The day summary
   shows a large kcal total and a protein/carbs/fat breakdown (grams + a thin
   proportional bar). **No calorie/macro goals or targets in P28** — goals,
   streaks, and weekly trends are explicitly deferred (they need a user-prefs
   surface and their own prompt). The bar is proportion-of-today, not
   proportion-of-goal.

---

## Goal / Definition of Done

1. The Calories tab opens on **today's diary**: date header, daily totals
   (kcal + P/C/F), and entries grouped by meal in `breakfast → lunch → dinner →
   snack` order, each meal showing its own subtotal. Empty day shows a friendly
   empty state with an "Add food" call to action.
2. **Add food** opens a chooser → scan (P27 flow) · search · manual (P27 form).
   Any resulting macro card offers **Add to diary** → meal + amount sheet with a
   live macro preview → `POST /log` for the **currently-viewed day** → the row
   appears in the right meal and totals update.
3. **Edit** an entry (tap a row): change amount and/or meal → `PATCH /log/{id}`;
   totals recompute. **Delete** an entry: swipe or a delete control → optimistic
   remove with **Undo** → `DELETE /log/{id}`.
4. **Day navigation** works: prev/next/today; cannot navigate past today; each
   change refetches `GET /log?date=` for that day. Loading and error states are
   handled (skeleton on first load, inline retry on failure).
5. All new UI is **dark-only, English-only**, Tailwind-only, reuses existing
   design tokens/primitives (no new UI kit), every control ≥ 44 px with
   `focus-visible` rings, respects `prefers-reduced-motion`, and keeps the
   `env(safe-area-inset-bottom)` padding so the tab bar never overlaps content.
6. **Gates green:** frontend `npx tsc --noEmit`, `npx eslint src` (0 warnings),
   `npx vitest run`, `npx playwright test`. Backend untouched but run as a
   regression: `ruff check app/`, `mypy app/ --strict`,
   `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`.
7. **No backend file and no frozen pose-core file changed.** Existing files
   edited are **only**: `frontend/src/components/CaloriesPanel.tsx` (extend),
   `frontend/src/lib/nutritionApi.ts` (add diary wrappers),
   `frontend/src/types.ts` (additive types), and — only if it already asserts the
   P27 landing — the relevant `__tests__`/e2e spec. Prove it with
   `git diff --stat origin/main...feat/p28-calorie-diary-ui`.

---

## Guardrails specific to P28

- **Additive-only, frontend-only.** No backend edits — the API is done. No
  existing table, router, or schema is touched. Do not "improve" P27 files beyond
  the diary wiring listed above.
- **Frozen core untouched.** No import-and-modify of any file in the roadmap's
  frozen list (camera/pose hooks, `CameraFeed`, `PoseOverlay`, renderers, etc.).
  The diary reads finished data via the API only.
- **Privacy.** Never log diary contents beyond ids/counts (matches P27). No new
  network egress except the existing nutrition endpoints. Barcode decoding stays
  on-device (P27 `BarcodeScanner`, reused as-is).
- **Reuse, don't reinvent.** Use `FoodMacroCard`, `BarcodeScanner`,
  `ManualFoodForm` from P27; the `apiFetch`/`apiJson` helpers; existing tokens
  (`bg-surface-raised`, `text-accent`, `shadow-elev-*`, `ease-spring`, the
  `PRIMARY_BTN`/`SECONDARY_BTN` patterns already in `CaloriesPanel`). If a score
  ring or similar primitive fits the totals dial, import it — never modify it.
- **Code style.** Strict TS, no `any`; components `memo` where they own a view;
  Google-style comments on non-obvious logic; constants `UPPER_SNAKE_CASE`;
  absolute-relative imports consistent with the file's neighbours.
- **Tests.** Vitest with mocked `fetch` and a mocked scanner module (as P27
  does); assert the optimistic-then-reconcile and rollback paths, day-nav
  refetch, and IDOR-irrelevant client behaviour (404 on a foreign/edited entry
  surfaces an error, not a crash). Playwright covers the tab layout + add→see-row
  happy path.

---

## Per-stage git shorthand

Every stage ends with **Commit + push** on `feat/p28-calorie-diary-ui`:
```bash
git add -A
git commit -m "<the stage's message>"
git push origin feat/p28-calorie-diary-ui
```
**The next stage does not begin until that push succeeds and the gate is green.**

> **Environment note (this machine):** the working tree is on a OneDrive/FUSE
> mount. Before Stage 0, on WSL2: `rm -f .git/index.lock` (clear the stale lock)
> and normalize once — `git add --renormalize . && git commit -m "[chore]
> normalize line endings (LF)"` — so P28 diffs are clean and the frozen-core
> `git diff` proof is meaningful. Confirm `git diff -w` is empty afterward.

---

## Stage 0 — Branch + baseline
**Goal:** a green suite before any change; the P28 doc lands with the branch.
```bash
git checkout -b feat/p28-calorie-diary-ui
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && cd ..
ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 -q
```
**Gate:** all pass. **Commit + push:** `[P28] chore: branch baseline for calorie diary UI`.

---

## Stage 1 — Types + diary API wrappers + day helpers
**Goal:** the typed client surface the diary UI builds on.

**Tasks**
- `frontend/src/types.ts` (additive, below the P27 `FoodItemOut`):
  `Meal = "breakfast" | "lunch" | "dinner" | "snack"`, `LogEntryOut`
  (`id, logged_date, meal, amount_g, kcal, protein_g, carbs_g, fat_g, food: FoodItemOut`),
  `DailyTotals` (`kcal, protein_g, carbs_g, fat_g`), `DailyLogOut`
  (`log_date, entries: LogEntryOut[], totals: DailyTotals`). Match the P27
  Pydantic schemas exactly.
- `frontend/src/lib/nutritionApi.ts` — add diary wrappers next to the existing
  `lookupBarcode` / `createManualFood` / `searchFoods`:
  - `logFood(body: { food_item_id; logged_date; meal; amount_g }): Promise<LogEntryOut>` → `POST /log`.
  - `getDailyLog(dateISO: string): Promise<DailyLogOut>` → `GET /log?date=`.
  - `updateLogEntry(id, patch: { logged_date?; meal?; amount_g? }): Promise<LogEntryOut>` → `PATCH /log/{id}`.
  - `deleteLogEntry(id): Promise<void>` → `DELETE /log/{id}` (204 → resolve).
  - Reuse `apiJson`; map non-OK to the server `detail` like the P27 wrappers.
- New `frontend/src/lib/day.ts` (pure): `todayISO()`, `addDays(iso, n)`,
  `isToday(iso)`, `formatDayLabel(iso)` ("Today" / "Yesterday" / "Mon, 8 Jul").
  Local-time `YYYY-MM-DD`, no `Date` timezone drift.

**Tests** (`__tests__/nutritionApi.test.ts` additions, `__tests__/day.test.ts`):
each wrapper hits the right method/URL/body (mocked fetch); 204 delete resolves
void; error mapping surfaces `detail`. Day helpers: month/year rollover,
`isToday`, label formatting, DST-safe add.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P28] feat: diary API wrappers + day helpers + types`.

---

## Stage 2 — Add-to-diary flow
**Goal:** turn any macro card into a logged diary row.

**Tasks**
- New `frontend/src/components/AddToDiarySheet.tsx` — props `{ food: FoodItemOut;
  dateISO: string; defaultMeal?: Meal; onLogged(entry): void; onCancel(): void }`.
  Meal selector (4 chips), amount input (numeric, grams; prefilled from
  `serving_size_g ?? 100`; a "1 serving"/"100 g" quick toggle when a serving
  exists), and a **live preview** of kcal/P/C/F for the entered amount computed
  from the food's per-100 g values. "Add to diary" calls `logFood` for `dateISO`
  and returns the created `LogEntryOut`; disabled while pending; errors inline.
- `CaloriesPanel.tsx` — on the P27 `product` state, add **Add to diary** as the
  primary CTA (keep "Scan another"/"Done"), opening the sheet; on success, close
  the add-flow and return to the diary with the new row present.
- Snapshot preview math lives in one tiny pure helper (e.g. `previewMacros(food,
  amount_g)` in `nutritionApi.ts` or `lib/day.ts`'s sibling) so it is unit-tested
  and cannot drift from the server formula.

**Tests:** AddToDiarySheet — default amount from serving vs 100 g; preview
recomputes on amount change; meal selection; `logFood` called with the
viewed-day date; pending disables submit; error path shows a message and does not
call `onLogged`.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P28] feat: add scanned/searched/manual food to the diary`.

---

## Stage 3 — Diary day view (totals · meals · nav · edit/delete)
**Goal:** the everyday screen.

**Tasks**
- New `frontend/src/components/DiaryDay.tsx` (memo) — owns the day's data:
  fetches `getDailyLog(dateISO)` on mount and on date change, renders the date
  header (`‹ · Today · ›`, future-capped), a **totals summary** (kcal headline +
  P/C/F grams with proportional bars), and meal sections in fixed order each with
  a subtotal and its entry rows. Skeleton on first load; inline retry on fetch
  error; empty state with "Add food".
- New `frontend/src/components/DiaryEntryRow.tsx` — food name/brand, amount, kcal,
  and macro micro-line; tap opens edit (reuse `AddToDiarySheet` in an "edit"
  mode, or a slim `EditEntrySheet`) → `updateLogEntry`; delete control →
  optimistic remove + **Undo** (a few seconds) → `deleteLogEntry`.
- New `frontend/src/components/AddFoodChooser.tsx` — the "Add food" entry point:
  scan (P27 machine) · **search** (`searchFoods`, debounced, results → macro card
  → AddToDiarySheet) · manual (P27 `ManualFoodForm`). Reuses P27 components; no
  camera-hook contact.
- `CaloriesPanel.tsx` — restructure the tab so `DiaryDay` is the home and the
  scan/search/manual flows are launched from it. Preserve every P27 state
  (scan/loading/product/not-found/manual/error) inside the add-flow. Totals and
  entries reflect adds/edits/deletes without a manual refresh.

**Tests:** DiaryDay — renders totals + grouped meals from a mocked `getDailyLog`;
day-nav prev/next refetches with the new date and next is capped at today; empty
state; fetch-error retry. DiaryEntryRow — edit calls PATCH and updates totals;
delete is optimistic, Undo restores, failed delete restores. AddFoodChooser —
search debounces and maps results; each sub-flow reaches the sheet.

**Gate:** `npx tsc --noEmit && npx eslint src && npx vitest run`.
**Commit + push:** `[P28] feat: daily diary — totals, meal groups, day nav, edit/delete`.

---

## Stage 4 — Premium polish + regression sweep + PR
**Goal:** make it feel first-party; prove the core never moved; ship.

**Tasks**
- **Polish pass:** spring/press transitions consistent with the app, subtle
  count-up on the kcal total (reduced-motion safe), meal-section iconography,
  balanced empty/loading/error states, generous touch targets, and the
  community-data disclaimer carried onto any product surface (OFF requirement).
  No layout jank when the tab bar auto-hides rules apply.
- **Frozen-core proof:** `git diff --stat origin/main...feat/p28-calorie-diary-ui`
  — existing files changed are only those in Definition of Done §7; **zero**
  backend files, zero frozen frontend files.
- **Full regression:** frontend `npx tsc --noEmit && npx eslint src && npx vitest
  run && npx playwright test`; backend `ruff check app/ && mypy app/ --strict &&
  pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`.

**Commit + push:** `[P28] polish: diary premium pass; verify pose core untouched`.
Then open a PR **`[P28] Calorie tracker: diary UI, daily totals, premium polish`**,
and **STOP**. Deploy to `hf` only after the PR is merged (per the roadmap: `hf`
is the deploy target, not a per-stage push).

---

## Out of scope for P28 (later prompts)
- Calorie/macro **goals**, targets, streaks, and weekly/trend charts (need a
  user-prefs surface — own prompt).
- Editing a food's stored nutrition (as opposed to a diary entry's amount);
  favourites/recents beyond search; copy-yesterday / meal templates.
- OFF full-text remote product search (still local-cache search only).
- Cache TTL/refresh; offline diary DB; multi-device unit-pref sync.
- Theme (light mode) + i18n — their own isolated prompt.
