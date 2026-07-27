# P34.2 — Calorie Budget: Daily Target, Remaining Macros, Gentle Activity-Equivalent

> Continuation of P34. Executable prompt for Claude Code, run **autonomously**
> (see "Autonomy"). Additive full-stack (small). Read
> `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. Pose core frozen.

- **Owner:** Claude Code (autonomous)
- **Branch:** `feat/p34_2-calorie-budget`
- **Depends on:** P34.1 merged (one-tap diary log)
- **New thesis metric:** none — explicitly a **product feature** (engagement;
  supports the SUS study).

---

## Why P34.2 exists

The diary shows what you *ate* but not what you have *left* — the number that
actually motivates. Users set (or compute) a daily energy + protein target and
watch it count down as they log. This also **hardens the log-outcome ambiguity**
from device testing ("added a scan, wasn't sure it saved, totals looked zero"):
when a successful log visibly drops "remaining," the save is self-proving; when
it fails, the failure must be loud, not small red text.

Product intent (user): a maintenance/target budget, remaining shown as you scan
and log, and — over budget — an **encouraging, non-shaming** nudge, optionally
expressed as a friendly activity-equivalent, never a "burn it off" quota.

---

## Barcode-first principle (backbone — do not change)

Barcode scanning is the **primary** way food gets into the diary and stays that
way. In this market almost everything — packaged chicken, eggs, drinks — carries
a retail barcode, so scan → one-tap log is the fastest, most accurate path and
the backbone of the whole calorie feature. Manual entry is the **fallback** for
the rare unlabeled item or an OFF miss.

P34.2 is **additive on top of** the scan flow, never a replacement:

- The barcode scanner and the P34/P34.1 scan → product card → one-tap log path
  are **preserved unchanged**. Do not touch `BarcodeScanner.tsx` or the scan
  state machine's decode/lookup/one-tap-log behavior.
- The budget/remaining number simply reflects whatever gets logged — and the
  scan path must feed it exactly like the manual path does (same `logFood`
  call, same visible decrement of "remaining" on return).
- Do not make manual entry more prominent than scanning, and do not add friction
  to the scan flow. If anything, "remaining" moving right after a scan should
  make scanning feel even more rewarding.

## Decisions (settled — do not stop to ask)

1. **Manual target first.** The user enters a daily kcal target and a daily
   protein target (g); carbs/fat targets optional (leave blank = not tracked).
   Auto-compute from a profile (Mifflin–St Jeor) is a **later** prompt, not this
   one. Keep the door open (don't hardcode assumptions that block it).
2. **Server-persisted, additive.** New migration `0009_nutrition_goal`: a
   `nutrition_goals` table keyed by `user_id` (one row per user) —
   `kcal_target int`, `protein_target_g float?`, `carbs_target_g float?`,
   `fat_target_g float?`, `updated_at`. `GET /api/v1/nutrition/goal` (returns the
   row or an empty/null goal) + `PUT /api/v1/nutrition/goal` (upsert). Auth-gated,
   user-scoped. No existing table touched.
3. **Remaining, not just consumed.** DiaryDay shows, for the viewed day:
   `remaining kcal = target − consumed` (and remaining protein) as the hero
   number when a target exists; falls back to today's plain totals when no target
   is set (with a one-tap "Set a daily target" entry).
4. **Over-budget tone = encouraging, optional, never shaming.** When consumed >
   target: a calm line ("You're a bit over today — no stress.") plus, **only if
   the user opts to see it**, a rough activity-equivalent for the surplus
   ("≈ 30 min brisk walk"), computed from a simple MET table for a couple of
   common activities. No mandate, no guilt, no precise "you must exercise X."
   Never frame exercise as punishment/compensation.
5. **Log-outcome hardening (folds the open bug in here).** A successful log shows
   an unmistakable confirmation *and* the remaining number visibly updates on
   return; a failed log shows a clear error with a retry and never looks like
   success. Add a regression test that a logged entry moves the day's totals.

---

## Goal / Definition of Done

1. User sets a daily kcal + protein target once; it persists across sessions and
   devices.
2. The Calories tab shows **remaining** kcal + protein for the viewed day; each
   log (scan or manual) visibly decrements it on return — so "did it save?" is
   answered by the number moving.
3. Over budget → a calm, encouraging message; an **optional** activity-equivalent
   for the surplus (opt-in reveal), phrased supportively.
4. Existing tests pass; new backend + frontend covered; migration up/down clean
   on SQLite **and** Postgres; `ruff`/`mypy --strict`/`tsc`/eslint clean; pose
   core untouched.

---

## Stage A — Goal model + API (additive backend)

- Migration `0009_nutrition_goal` (additive): `nutrition_goals` table as in
  decision 2. `nc`-style: no existing row/table altered.
- ORM model `NutritionGoal` in `app/models.py` (flat file, additive).
- Schemas: `NutritionGoalIn` (kcal_target ≥ 0, protein_target_g ≥ 0 optional,
  carbs/fat optional) + `NutritionGoalOut`. Reasonable upper bounds (e.g.,
  kcal ≤ 20000) so bad input 422s.
- `GET /api/v1/nutrition/goal` → the user's goal or a null/empty goal (200, not
  404, so the client renders the "set a target" state cleanly).
- `PUT /api/v1/nutrition/goal` → upsert the single per-user row.
- **Gate:** pytest — set/get/update/isolation-between-users; validation bounds;
  migration up+down on SQLite; `ruff`/`mypy --strict`. (Note the P27 slowapi
  gotcha: no `from __future__ import annotations` in the router module.)
- Commit: `[P34.2] feat: nutrition goal model + GET/PUT API (migration 0009)`

## Stage B — Budget UI + remaining + log-outcome hardening (frontend)

- `nutritionApi.ts`: `getGoal()` / `putGoal()` wrappers.
- A small **target editor** (sheet or a card in the Calories tab; or a Settings
  row — agent's call, keep it discoverable) to set/edit kcal + protein targets.
- `DiaryDay`: when a target exists, show **remaining** kcal + protein as the hero
  (consumed still visible secondarily); when none, show plain totals + a
  "Set a daily target" affordance. Remaining updates on the normal remount/
  refetch after a log.
- Over-budget: calm message + an **opt-in** "What's that in activity?" reveal
  using a tiny MET table (walk, jog — 2–3 activities) in a pure, tested helper.
  Supportive copy only.
- Log-outcome: keep P34.1's green confirmation; ensure a failed `logFood`/`putGoal`
  shows a clear inline error + retry (no silent close, no tiny-red-text-only).
- **Gate:** vitest — remaining math (target−consumed, protein), no-target
  fallback, over-budget message + opt-in activity reveal, MET helper units,
  log failure surfaces retry; the P34.1 refresh regression test still green;
  `tsc`/eslint clean.
- Commit: `[P34.2] feat: calorie budget — remaining kcal/protein + gentle over-budget nudge`

End with a PR to `main`, then STOP for review.

---

## Autonomy — how Claude Code should run this prompt

The user reviews **outcomes**, not steps.

- **Decide and proceed.** Small choices left open here (target-editor placement,
  exact copy, which 2–3 MET activities, component split) are yours — pick the
  sensible option, keep moving, record the choices in the PR description. Do not
  stop to ask.
- **Move faster:** you may complete both stages in one pass. Still run each
  stage's gate and commit per stage (the staged commits are the audit trail),
  but don't pause for human input between them.
- **Self-verify instead of asking.** Green gates are the bar (pytest + `ruff` +
  `mypy --strict` for backend; vitest + `tsc` + eslint for frontend; migration
  up/down). Fix forward on failures within the guardrails.
- **Only pause for the human at:** (a) the final PR/merge, and (b) any
  prod-touching or destructive action (deploy, `git push hf`, migration **run**
  against prod, Space/env change, data delete). Writing the migration file is
  fine; *applying it to prod* is the user's step.
- Guardrails are non-negotiable in autonomous mode: pose core FROZEN, additive
  only (new table/model/router additions; no existing table or prop contract
  changed), no JWT in localStorage, structlog only, dark/English-only, branch →
  stage-gate → commit → push discipline. If an EXISTING test fails for a reason
  you can't fix without touching frozen/core code, STOP and report.

---

## Health-values guardrail (specific to P34.2 — do not soften)

- No shaming, guilt, or "compensation/burn-it-off" framing anywhere. Over-budget
  copy is calm and encouraging; the activity-equivalent is opt-in and phrased as
  friendly context, never a requirement.
- No weight-loss/deficit advice or medical claims. The target is a user-entered
  number the app subtracts from — nothing more in this prompt.
- Targets have sane bounds; the UI never encourages extreme values.
