# RESPONSIVE_MOBILE_P19–P21 — Fit Any Phone, Reachable Camera Flip, Collapsing Selector

> Execute strictly in order **P19 → P20 → P21**. Each phase ships independently and is
> dogfoodable on a real phone before the next begins. This is a **layout/UX pass only** —
> it does NOT touch the pose pipeline, scoring, WebSocket, or model. No backend changes.
> Frontend only: `frontend/src/**`.
>
> Source of the problems: tested on iPhone (Safari). Three issues, one phase each.

---

## >>> PRIMARY GOAL = P19 <<<

P19 (viewport fix) is the goal to execute **now**. It is the root cause of "the screen
does not adjust to my mobile" and of the Record/Finish bar being unreachable. P20 and P21
are separate follow-on runs, each launched only after the previous one is green and
dogfooded on a phone. Do not chase all three at once.

---

## 0. Constraints (inherited from project rules — do not violate)

- TypeScript strict, **no `any`** — proper types or `unknown`.
- **Tailwind utility classes only.** No inline styles except for dynamic values
  (the existing `env(safe-area-inset-*)` inline styles are allowed and stay).
- Component naming PascalCase, hooks camelCase.
- Repo lives in OneDrive → **write files via bash heredoc, then verify with `wc -l` /
  re-read**; never trust a silent editor write. Recover any truncated file with
  `git show HEAD:<path>`.
- Run `npx vitest run` and `npx eslint .` (in `frontend/`) green before each phase closes.
- Commit format: `[P19] fix: ...` / `[P20] feat: ...` / `[P21] refactor: ...`.

---

## 1. Dynamic-by-design strategy (governs ALL phases — not a later fix)

The goal is **continuous fluid adaptation to any screen**, not patching specific phones as
they break. We achieve "works on any phone" with layout that flexes by nature, so there is
never a per-device fix to do later. Every phase below must follow these principles:

1. **Dynamic viewport units, not fixed.** Heights use `svh`/`dvh` (P19). Never `100vh`,
   never fixed pixel heights for the shell.
2. **Fluid type & spacing with `clamp()`.** Where a value must scale with the screen, use
   `clamp(min, preferred-vw, max)` instead of breakpoint jumps. Add a small set of fluid
   tokens to `tailwind.config.js` (e.g. `text-fluid-sm/-base/-lg`, `gap-fluid`) so sizes
   grow smoothly from a 320px phone to a tablet with no snapping.
3. **Intrinsic, content-driven layout.** Use `min()`, `max()`, `minmax()`, `flex-1`,
   `flex-wrap`, and `auto-fit/auto-fill` grids so columns and panels resize themselves.
   Avoid any fixed-width container that can overflow a narrow screen.
4. **Container queries over device guesses.** For panels that should reflow based on the
   space *they* have (not the whole window), use Tailwind container queries
   (`@container` / `@sm:` via `@tailwindcss/container-queries`). This is what makes a
   component "adapt to any home/host size" without knowing the device.
5. **Safe-area aware everywhere.** Any edge-anchored element honors
   `env(safe-area-inset-*)` (notch, Dynamic Island, home indicator, rounded corners).
6. **No horizontal scroll, ever.** `overflow-x` must never appear; text wraps or truncates,
   never forces width.
7. **Touch targets ≥ 44px** regardless of screen (already the `min-h-11` convention — keep it).

> Rule of thumb for the implementer: if a layout problem can only be solved by adding
> another breakpoint for a specific phone, the layout is wrong — make it fluid instead.

### Supported range = the definition of "any phone" (test matrix)
The board is only "done" when these all pass with **zero clipping and zero horizontal
scroll**, portrait AND landscape:

| Width | Represents | Check |
|-------|-----------|-------|
| 320px | iPhone SE (1st gen) / smallest Android | floor — nothing overflows |
| 360px | common budget Android | fluid sizing readable |
| 375px | iPhone SE 2/3, mini | both action bars reachable |
| 393px | iPhone 15/16 | primary target |
| 430px | iPhone Pro Max | largest phone |
| 768px | small tablet / split-screen | grid begins to widen |
| 1024px+ | desktop / thesis demo | unchanged `lg` layout |

Plus: **landscape** at 667×375 and 852×393 (short height is the hardest case), and a
**foldable/split-screen** sanity check (~280–320px). Each phase's Playwright `Verify`
runs against this matrix, not just one size.

---

## P19 — Make the app fit the visible viewport on every phone

### Root cause
`App.tsx` root is `className="flex h-screen w-screen flex-col ..."`. `h-screen` = `100vh`.
On iOS Safari `100vh` equals the viewport **with the browser toolbars hidden**, so it is
taller than what is actually visible → the bottom action bar (Record / Finish) and the
lower panel are pushed below the fold and cannot be reached. `viewport-fit=cover` and the
`env(safe-area-inset-*)` paddings are already in place; only the height unit is wrong.

### Changes
0. **Lay the fluid foundation (one-time, enables every later phase).**
   - Add `@tailwindcss/container-queries` to `frontend` devDeps and register it in
     `tailwind.config.js` `plugins`.
   - In `tailwind.config.js` `theme.extend`, add fluid tokens, e.g.:
     ```js
     fontSize: {
       "fluid-sm":  "clamp(0.72rem, 0.68rem + 0.3vw, 0.85rem)",
       "fluid-base":"clamp(0.85rem, 0.80rem + 0.4vw, 1rem)",
       "fluid-lg":  "clamp(1rem, 0.92rem + 0.6vw, 1.35rem)",
     },
     spacing: { "fluid": "clamp(0.5rem, 0.4rem + 1vw, 1rem)" },
     ```
   - These are the smooth-scaling sizes the rest of the board reaches for instead of
     adding new breakpoints.
1. **`frontend/src/App.tsx`** — root `<div>`: replace `h-screen` with the dynamic
   viewport height. Use `h-[100svh]` (small-viewport height = always-visible area, the
   safest for a fixed app shell with a bottom bar). Keep `w-screen`.
   - If a desktop regression appears, gate it: `h-[100svh] supports-[height:100svh]:h-[100svh]`
     is unnecessary — `svh` is supported in all current Safari/Chrome; a plain
     `min-h-[100svh] h-[100svh]` is enough.
2. **`frontend/src/index.css`** — add a tiny base rule so `html, body, #root` carry the
   same dynamic height and cannot scroll the shell:
   ```css
   html, body, #root { height: 100%; overflow: hidden; overscroll-behavior: none; }
   ```
   (Per-panel `overflow-y-auto` already handles internal scrolling.)
3. Audit the live-view column heights. The `<main>` grid is
   `grid-rows-[minmax(220px,1fr)_auto]` on mobile. On a short phone (e.g. iPhone SE,
   ~667px) the `minmax(220px,...)` camera row plus the selector row plus the two action
   bars can exceed the viewport. Lower the camera floor to `minmax(180px,1fr)` and confirm
   the bottom bar stays pinned.

### Acceptance
- On iPhone Safari (real device or DevTools iPhone SE + iPhone 15 Pro), the **Record /
  Finish bar is fully visible without scrolling** in both portrait and landscape.
- No element is hidden behind the Dynamic Island / home indicator.
- Desktop (`lg`) layout is unchanged.

### Verify
- `cd frontend && npx vitest run && npx eslint .` → green.
- Playwright: add `e2e/` viewport check at 375×667 and 393×852 asserting
  `[data-testid="finish-set-btn"]` is in the viewport (`toBeInViewport()`).
- Manual: load on the actual iPhone, confirm both bars reachable.

---

## P20 — Put the camera-flip control where a thumb can reach it

### Root cause
The front/back flip button (`data-testid="flip-camera"`) sits in the **top-right header**,
sharing a row with the voice toggle and the user menu. On a narrow iPhone these crowd
together near the Dynamic Island and the flip target is awkward / can clip. The header
also holds the back button + title + latency badge on the left.

### Changes (pick ONE approach — recommended: A)
**A. Move flip onto the camera feed (recommended).**
- Render the flip button as an absolutely-positioned overlay control inside the camera
  container in `App.tsx` (the `<div className="relative ... rounded-2xl bg-black ...">`
  that already wraps `CameraFeed`/`PoseOverlay`/`CameraHud`). Anchor it
  `absolute bottom-3 right-3 z-20`, 44×44 min target, same styling tokens as today.
- Remove the flip button from the header. Keep voice + user menu in the header.
- Keep the existing `onClick={() => void camera.flip()}` and `disabled={!camera.ready}`
  logic and `aria-label` switching — only the location changes.

**B. (fallback) Keep in header but harden it.**
- Wrap the right-side header cluster so it never overflows: `flex-nowrap`, `shrink-0` on
  each button (already present), and ensure total width fits 320px. Hide the latency badge
  below `sm` (already `hidden sm:inline-flex`). Only choose B if A causes overlay clutter
  with the REC indicator (which lives `top-16 left-3`, so bottom-right is clear).

### Acceptance
- Flip front/back works from a comfortable thumb position in portrait on iPhone.
- The control never overlaps the REC indicator, the HUD score, or the pose skeleton.
- `aria-label` still flips between "Switch to back/front camera"; `data-testid="flip-camera"`
  preserved so existing tests pass.

### Verify
- `npx vitest run` — update any test that located the flip button by header context.
- Manual: flip both directions mid-session on the phone; confirm mirroring still correct
  (`mirrored={camera.facingMode === "user"}` path unchanged).

---

## P21 — Collapse the selector after a choice so camera + score dominate

### Root cause
In **posing mode** the selector row renders, inline and always-expanded:
`ModeToggle` + `DivisionSelector` (dropdown) + `PoseSelector`. `PoseSelector` is a
`flex-wrap` of every mandatory pose pill in the division — it wraps to 2–3 rows on a phone
and steals vertical space from the camera feed and from the `PosingPanel` score readout
(Pose / Symmetry / Hold). Exercise mode has the same shape via `ExerciseSelector`.
User's exact ask: *after choosing, squeeze the list to show only the chosen one, and let
the camera + scoring screen be dominant.*

### Design — "collapsed chip, expand on tap"
Introduce a small reusable disclosure so each picker is **one compact line by default**:
- Default state: a single pill showing the **selected** item label + a chevron
  (e.g. `Front Double Biceps ⌄`). One row, fixed height.
- Tap → opens a lightweight popover / bottom-sheet listing the options (reuse the existing
  pill list markup from `PoseSelector` / the card grid from `ExerciseSelector`).
- Pick → selection updates, sheet closes, row collapses back to the single chip.
- Close on: select, tap-outside, `Esc`. Keep it keyboard-accessible (`role` preserved).

### Changes
1. New component **`frontend/src/components/CollapsibleSelect.tsx`** — a generic disclosure
   wrapper (controlled `open` state via `useState`, no external lib). Props: trigger label,
   `open`, `onToggle`, and `children` (the expanded options). Mobile = bottom sheet
   (`fixed inset-x-0 bottom-0`), `lg` = inline popover. Tailwind only.
2. **`PoseSelector.tsx`** — wrap the existing pill `radiogroup` in `CollapsibleSelect`;
   trigger shows the active pose's label + division hint. Collapse on `onChange`.
3. **`ExerciseSelector.tsx`** — same treatment; trigger shows the active exercise; the
   search + card grid live inside the sheet. (Search box moves into the sheet.)
4. **`App.tsx`** selector row — the row becomes a single compact line in both modes:
   `ModeToggle` + one collapsed `DivisionSelector` + one collapsed `Pose`/`Exercise` chip.
   The freed vertical space flows to `<main>` automatically (it is `flex-1`), so the camera
   and the `PosingPanel`/`CoachingCues` score area grow.
5. On `lg` (desktop) you MAY keep the expanded inline list if space allows — gate the
   collapse to below `lg` so the desktop thesis-demo view is unchanged.

### Acceptance
- In posing mode on a phone, the selector occupies **one row**; the camera feed and the
  Pose/Symmetry/Hold readout are visibly larger than before.
- Changing division still resets the pose to that division's first mandatory
  (existing `selectDivision` logic untouched).
- Exercise mode chip collapses the same way; `onShowHowTo` (the "?" / how-to) still
  reachable from inside the expanded sheet.
- All existing `data-testid`s (`pose-*`, `mode-*`, `division-select`, exercise cards)
  remain present so tests keep passing.

### Verify
- `npx vitest run` — extend `PoseSelector.test.tsx` and `ExerciseSelector.test.tsx`:
  collapsed by default, opens on trigger click, collapses on selection.
- Playwright at 393×852: assert the camera container's rendered height **increases**
  vs. the pre-P21 baseline (or simply that the selector row height ≤ one row).
- Manual on iPhone: pick a pose, confirm the list disappears and the score panel grows.

---

## Done = all three green on a real iPhone

The goal board is complete when, on the actual phone:
1. **P19** — both action bars reachable, nothing clipped by notch/home-indicator.
2. **P20** — camera flip is one comfortable thumb tap.
3. **P21** — after choosing, the picker is a single chip and the camera + score screen
   dominate the view.

Keep working this board top-to-bottom until every Acceptance + Verify box above is checked.
