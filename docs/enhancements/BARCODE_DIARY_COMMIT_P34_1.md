# P34.1 — Barcode → Diary Commit: One-Tap Log from a Scan

> Continuation of P34 (barcode scanner now decodes). Executable prompt for
> Claude Code, run **autonomously** (see "Autonomy" below). Frontend-only,
> additive. Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. Pose core frozen.

- **Owner:** Claude Code (autonomous)
- **Branch:** `feat/p34_1-barcode-diary-commit`
- **Depends on:** P34 merged (scanner decodes on device)
- **New thesis metric:** none (product/usability) — closes the calorie-logging
  loop the SUS study exercises.

---

## Why P34.1 exists (device test, iPhone PWA, 2026-07-24)

Scanning works (verified with a real can). But after a scan the user lands on
the **product preview** card (`CaloriesPanel.tsx` `addMode === "product"`) whose
buttons are `Add to diary` / `Scan another` / `Done`. **"Done" closes without
logging** (`closeAdd`); only `Add to diary` advances to a *second* sheet
(`AddToDiarySheet`, meal + amount) whose submit is the actual `logFood` POST.
The user tapped "Done" — the natural "I'm finished" action — so the item was
never written to the diary, and daily totals didn't move.

Root cause: **the scan produces a preview, not a commit, and the commit is a
non-obvious two-step behind a button that shares a screen with a discard button
labeled "Done."** The refetch path is fine — `DiaryDay` reloads on return and
totals are server-computed; nothing is logged because no POST is ever sent.

Product intent (user's words): "who would track manually when you can just scan"
— so a scan should log in **one tap**, with adjustment available but optional.

---

## Decisions (settled — do not stop to ask)

1. Post-scan primary action = **log immediately** with default amount =
   `serving_size_g ?? 100` and meal **inferred from local time** (breakfast
   <11:00, lunch 11:00–16:00, dinner 16:00–21:00, else snack). One tap → written
   to the currently-viewed diary day.
2. After the one-tap log, show a **success confirmation** ("Added · {kcal} kcal
   to {meal}") with an **"Adjust"** action that opens the existing
   `AddToDiarySheet` pre-filled to edit that entry (meal/amount), and a
   **"Scan another"** action. The ambiguous **"Done" button is removed** — the
   back arrow + "Scan another" already cover navigation, and closing is
   non-destructive because the item is already logged.
3. The name-search add path (`AddFoodChooser` → `onPick`) may keep the explicit
   `AddToDiarySheet` step (searching implies intent to choose amount), OR adopt
   the same one-tap+adjust pattern — agent's call; pick the one that's more
   consistent and note it in the PR.

---

## Goal / Definition of Done

1. On an installed iPhone PWA: scan a barcode → one tap → the item appears in
   today's diary and the day's kcal/mac/sugar totals increase, **without** a
   second sheet unless the user chooses "Adjust."
2. A successful log always shows a confirmation; a failed POST shows the error
   with a retry (never a silent close).
3. Diary totals reflect the new entry on return to the diary view (already true
   via remount+refetch — covered by a test so it can't regress).
4. Existing tests pass; new flow covered by vitest; `tsc`/eslint clean; pose
   core untouched.

---

## Stage A — One-tap commit + confirmation

- `CaloriesPanel.tsx`: in `addMode === "product"`, replace the three-button row
  with: primary **"Add to diary"** that calls `logFood` directly (default
  amount + inferred meal) → on success switch to a new `addMode === "logged"`
  confirmation state; secondary **"Adjust"** (opens `AddToDiarySheet` in edit
  mode on the just-created entry); secondary **"Scan another"**. Remove "Done".
- New `addMode === "logged"`: shows `FoodMacroCard` (or a compact summary) + the
  confirmation line + "Adjust" / "Scan another" / a plain back-to-diary.
- Errors from the direct `logFood` surface inline with a retry (reuse the
  existing `error` state + copy pattern); never fall through to a silent close.
- Meal-inference helper lives in `lib/macros.ts` or `lib/day.ts` (pure, tested),
  not inline.
- **Gate:** vitest — scan→product→one-tap logs (mock `logFood`, assert called
  with default amount + inferred meal), confirmation renders, "Adjust" opens the
  sheet pre-filled, POST failure shows retry; meal-inference unit tests across
  the day boundaries; existing CaloriesPanel/AddToDiarySheet suites green;
  `tsc`/eslint clean.
- Commit: `[P34.1] feat: one-tap diary log from a scanned product + confirmation`

## Stage B — Regression lock on the refresh path

- Add a vitest (or Playwright with mocked API) asserting that after a log the
  diary view reflects the new entry and higher totals on return — pins the
  remount/refetch behavior so a future refactor can't silently break it.
- **Gate:** the new test passes; full suite green.
- Commit: `[P34.1] test: diary reflects a newly logged entry (refresh regression)`

End with a PR to `main`, then STOP for review.

---

## Autonomy — how Claude Code should run this prompt

The user reviews **outcomes**, not steps. Run this autonomously:

- **Decide and proceed.** Where this doc leaves a small choice (decision 3,
  exact copy, where a helper lives, component split), pick the sensible option
  and keep moving — do **not** stop to ask. Record the choices in the PR
  description.
- **Move faster:** you may complete both stages in one pass. Still run each
  stage's gate and commit per stage (the staged commits are the audit trail),
  but you don't need to pause for human input between them.
- **Self-verify instead of asking.** Green gates (vitest + `tsc` + eslint) are
  the bar. If a gate fails, fix forward within the guardrails; if an *existing*
  test fails for a reason you can't fix without touching frozen/core code, STOP
  and report (that's a real signal, not a decision).
- **Only pause for the human at:** (a) the final PR/merge, and (b) any
  prod-touching or destructive action (deploys, `git push hf`, migrations,
  Space/env changes, deleting data). Everything else is yours to drive.
- Guardrails are **not** negotiable even in autonomous mode: pose core frozen,
  additive only, no JWT in localStorage, structlog only, dark/English-only,
  branch → stage-gate → commit → push discipline on the feature branch.

---

## Guardrails specific to P34.1

- Frontend-only. Edits limited to `CaloriesPanel.tsx`, a pure meal-inference
  helper in `lib/`, and tests. `AddToDiarySheet` is reused (edit mode already
  supported) — do not change its contract. No backend/API/schema change: the
  `/api/v1/nutrition/log` POST already exists and works.
- Additive: new `addMode` state value + new helper; no existing prop behavior
  changed. Barcode scanner untouched. Pose core untouched.
