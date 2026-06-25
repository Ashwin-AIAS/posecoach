# P23 — Navigation Shell + Settings Tab

> **Executable prompt for Claude Code.** Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md`
> first for the program guardrails. This prompt is **frontend-only** and **additive**:
> it introduces a bottom tab bar and a Settings tab. It adds **no backend, no
> database change, no migration**. The pose-estimation core is untouched.

- **Owner:** Claude Code
- **Branch:** `feat/p23-nav-shell`
- **Backend changes:** none
- **New thesis metric:** none (product feature — state this in the PR description)

---

## Goal / Definition of Done

A persistent bottom tab bar with four tabs — **Coach · Workouts · Calories ·
Settings** — wraps the existing app. Done means **all** of:

1. Tab bar renders on every screen **except** during a live set (`view === "live"`),
   where it hides for the immersive camera experience.
2. **Coach** tab = today's experience (Home + live flow + existing overlays),
   with **no behavioral or markup change** inside the Coach branch.
3. **Workouts** and **Calories** tabs render a polished "Coming soon" placeholder
   (on-brand, dark tokens) — no feature logic yet.
4. **Settings** tab is functional: profile/email, sign in/out, units (kg/lb)
   toggle, About/version, and delete-account (existing endpoint).
5. Every existing `vitest` and `playwright` test still passes; new components ship
   with their own tests; `tsc --noEmit` and `eslint` are clean.
6. No frozen pose-core file changed (verified by `git diff --stat`).
7. Dark-only, English-only. Each stage was committed and **pushed to `origin`**.

---

## Guardrails specific to P23

- **Only one existing file may be modified: `frontend/src/App.tsx`** — and only to
  host the tab bar and switch tab content. The Coach branch JSX is **wrapped**, not
  edited. Everything else is a **new file**.
- Do **not** touch any file in the frozen list (see roadmap §"Non-negotiable
  guardrails"). In particular, do not modify `usePoseStream`, `useCamera`,
  `CameraFeed`, `PoseOverlay`, `CameraHud`, or any `lib/pose*`/`hud*` module.
- Reuse existing tokens (`surface-base/raised/overlay/hairline`, `accent`,
  `font-display`, `ease-spring`, `shadow-elev-*`) and the `Icon` + `ScoreRing`
  primitives. No new colors, no new UI library, no inline styles except dynamic values.
- Units preference is **client-side only** (localStorage). Do **not** add it to the
  `User` model or write a migration.

---

## Prerequisites

```bash
cd frontend && npm ci          # ensure deps present (lucide-react already used)
```

No new runtime dependency is required for P23 (tabs, settings, and the units hook
use React + existing libs only).

---

## Stage 0 — Branch + green baseline

**Goal:** prove the suite is green *before* any change, so regressions are provable.

**Tasks**
1. `git checkout -b feat/p23-nav-shell`
2. Run the existing gates and record that they pass:
   ```bash
   cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run
   # backend is unchanged in P23, but confirm it still imports:
   cd .. && pytest -x --timeout=30 -q
   ```

**Acceptance gate:** all commands above pass on a clean checkout.

**Commit + push (required before Stage 1):**
```bash
git add -A
git commit -m "[P23] chore: branch baseline for nav shell"
git push origin feat/p23-nav-shell
```
> Do not proceed to Stage 1 until this push succeeds.

---

## Stage 1 — Tab-bar shell

**Goal:** introduce the four-tab bar; Coach renders the existing app unchanged;
Workouts/Calories/Settings render placeholders.

**New files**
- `frontend/src/types.ts` → add `export type TabKey = "coach" | "workouts" | "calories" | "settings"`.
- `frontend/src/components/TabBar.tsx` — fixed bottom bar, four buttons with
  `lucide-react` icons (e.g. `Dumbbell`/`Activity` for Coach, `ClipboardList` for
  Workouts, `Flame`/`Apple` for Calories, `Settings` for Settings). Props:
  `{ active: TabKey; onChange: (t: TabKey) => void; hidden: boolean }`. Use
  `surface-raised/80` + `backdrop-blur`, `shadow-elev-2`, `ease-spring`, an
  `accent` active state, `env(safe-area-inset-bottom)` padding, `min-h-11` hit
  targets, `data-testid="tab-bar"` and `data-testid="tab-<key>"` per button.
- `frontend/src/components/ComingSoon.tsx` — a centered, on-brand placeholder:
  `{ title: string; subtitle: string; icon }`. Used by Workouts and Calories.

**Edit (the only existing file touched)**
- `frontend/src/App.tsx`:
  - Add `const [tab, setTab] = useState<TabKey>("coach")`.
  - **Wrap, don't alter**, the existing render: keep the current header + overlays
    + `view === "home" ? <Home/> : <live JSX>` exactly as-is, but render it **only
    when `tab === "coach"`**.
  - For the other tabs render: `tab === "workouts" ? <ComingSoon .../>`,
    `tab === "calories" ? <ComingSoon .../>`, `tab === "settings" ? <SettingsPanel/>`
    (SettingsPanel arrives in Stage 2 — use a temporary `<ComingSoon/>` here until then).
  - Render `<TabBar active={tab} onChange={setTab} hidden={view === "live"} />` as
    the last child of the root container.
  - Reserve space so the bar never overlaps content: add bottom padding
    (`pb-[calc(env(safe-area-inset-bottom)+4rem)]`) to the scroll containers of the
    non-live tabs. The live view keeps the bar hidden, so it is unaffected.

**Tests**
- `frontend/src/__tests__/TabBar.test.tsx` — renders 4 tabs, click switches active,
  `hidden` prop removes it from the DOM.
- `frontend/src/__tests__/App.test.tsx` — **existing assertions must still pass**;
  add a case: starting tab is Coach and the existing Home testid is present.

**Acceptance gate**
```bash
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run
```
- Existing tests green; new TabBar test green; Coach renders the unchanged Home.

**Commit + push (required before Stage 2):**
```bash
git add -A
git commit -m "[P23] feat: bottom tab bar shell (Coach/Workouts/Calories/Settings)"
git push origin feat/p23-nav-shell
```
> Do not proceed to Stage 2 until this push succeeds.

---

## Stage 2 — Settings tab

**Goal:** a functional Settings tab that reuses the existing auth surface and adds
profile, units, about, and account deletion.

**New files**
- `frontend/src/hooks/useUnitPref.ts` — `kg | lb` preference persisted in
  `localStorage` (key `pc.units`), default `kg`. Returns `{ unit, setUnit }`.
  (Units only — never store auth/JWT here; that rule is unchanged.)
- `frontend/src/components/SettingsPanel.tsx` — full-screen tab content, mirroring
  the `HistoryPanel` structure (memoized, owns its header). Sections:
  - **Profile** — show `auth.user.email` when signed in; a Sign-in button
    (opens the existing `AuthModal`) when anonymous; a Log out button
    (`auth.logout()`). Reuse `useAuth`; do not reimplement auth.
  - **Preferences** — Units segmented control (kg / lb) bound to `useUnitPref`.
  - **About** — app name, version (read from `import.meta.env` or a constant),
    and a link to the privacy note. Static, on-brand.
  - **Account** — "Delete account" with a confirm step → `DELETE /api/v1/auth/account`
    via `apiFetch`; on success, call `auth.logout()` and return to Coach.
- `frontend/src/__tests__/SettingsPanel.test.tsx` — anonymous shows Sign in;
  signed-in shows email + Log out; units toggle persists; delete shows a confirm.

**Edit**
- `frontend/src/App.tsx`: replace the temporary Settings placeholder with
  `<SettingsPanel auth={auth} />`. (Optionally relocate the `UserMenu`'s History
  entry point — but do **not** remove or alter `UserMenu`; History stays reachable
  from Coach. Moving is optional and must not change `UserMenu` behavior.)

**Acceptance gate**
```bash
cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run
```
- Settings renders for both auth states; units persist across reload; existing
  tests still green.

**Commit + push (required before Stage 3):**
```bash
git add -A
git commit -m "[P23] feat: Settings tab (profile, units, about, delete account)"
git push origin feat/p23-nav-shell
```
> Do not proceed to Stage 3 until this push succeeds.

---

## Stage 3 — Polish, accessibility, regression sweep

**Goal:** make it feel premium and prove nothing in the core moved.

**Tasks**
1. **A11y:** tab bar is a `role="tablist"` with `aria-selected`; each tab button
   has an accessible label; focus-visible rings use `accent`; hit targets ≥ 44px.
2. **Motion:** active-tab transition uses `ease-spring`; respect
   `prefers-reduced-motion`.
3. **PWA:** confirm the bar sits above the iOS home indicator
   (`env(safe-area-inset-bottom)`) and the app still installs (manifest unchanged).
4. **Frozen-core proof:**
   ```bash
   git diff --stat origin/main...feat/p23-nav-shell
   ```
   The only existing file in the diff must be `frontend/src/App.tsx`. No file from
   the frozen list may appear. If one does, revert it.
5. **Full regression:**
   ```bash
   cd frontend && npx tsc --noEmit && npx eslint src && npx vitest run && npx playwright test
   cd .. && pytest -x --timeout=30 -q
   ```

**Acceptance gate:** all of the above pass; `git diff --stat` shows `App.tsx` as the
sole existing-file edit.

**Commit + push (final):**
```bash
git add -A
git commit -m "[P23] polish: a11y, motion, safe-area; verify pose core untouched"
git push origin feat/p23-nav-shell
```
Then open a PR to `main` titled `[P23] Navigation shell + Settings tab`, noting in
the description: frontend-only, additive, pose core untouched, dark/English-only.

---

## Test plan summary

| Area | New tests | Must stay green |
|------|-----------|-----------------|
| TabBar | render 4 tabs, switch, hidden-prop | — |
| Settings | both auth states, units persist, delete confirm | — |
| App shell | starts on Coach, Home still renders | all existing `App.test.tsx` |
| Regression | — | full `vitest` + `playwright` + `pytest` |

---

## Out of scope for P23 (do NOT build here)

- Any backend, database table, migration, or API endpoint.
- The actual workout logger and calorie tracker (P24–P28).
- Light/dark theme switching and i18n (a later, isolated prompt).
- Relocating or restyling any Coach-tab/pose surface.
