# RESPONSIVE_MOBILE_P19–P22 — Fit Any Phone, Reachable Flip, Collapsing Selector, Camera-First Layout

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

## P21 — Posing layout: camera + score MUST own ~70% of the screen  ⟵ ACTIVE GOAL

### Observed on production (posecoach-rho.vercel.app, iPhone, screenshot 22:12)
In **posing mode** the 8 pose pills (Front Double Biceps → Most Muscular) render as a
**tall vertical column pinned to the right edge**. That column stretches the selector area
to roughly the **top ~70% of the viewport**, with the Exercise/Posing toggle + division
dropdown floating in the vertical middle and the **entire left-upper area left as dead
black space**. The camera feed + the score "detector" (ScoreRing / `PosingPanel`) are
crushed into the **bottom ~30%** and partly cut off. The layout is inverted: the disposable
list is huge, the useful camera + score is tiny.

### Root cause in the DOM
The live-view selector row in `App.tsx` is `flex items-center gap-3` and contains
`ModeToggle` + `DivisionSelector` + `PoseSelector`. `PoseSelector`'s `radiogroup` is
`flex flex-wrap`; squeezed into the remaining right-hand width it has no room to flow
horizontally, so every pill wraps onto its **own line → a vertical stack**. That stack has
no height cap, so the selector row grows to ~8 pill-heights and pushes the `<main>`
(camera + score) far down. **`items-center` is why the toggle/division sit mid-screen and
the upper-left is empty.** This is a layout-shape bug, not just "needs collapsing."

### Hard requirement (the definition of done for P21)
On any phone in posing mode:
- **Camera + score panel together ≥ 70% of viewport height.**
- **Selector controls ≤ one compact row** (target ≤ 56px tall), pinned at the top.
- **Zero dead vertical space** above the camera.

### Design — pose picker becomes a one-line control, camera becomes the hero
1. **Kill the vertical pill stack.** Replace `PoseSelector`'s always-open `flex-wrap` list
   with a **single-line control**. Two acceptable forms — implement (A):
   - **(A) Collapsed dropdown chip (recommended, matches your ask "show only the chosen
     one"):** the row shows just the selected pose, e.g. `Front Lat Spread ⌄`, exactly like
     `DivisionSelector` already looks. Tap → bottom-sheet (mobile) / popover (`lg`) with the
     full pill list; pick → it closes and the row collapses back. The pose **hint** text
     (“Face the camera, arms out…”) moves OUT of the selector and into the `PosingPanel`
     so it no longer adds height up top.
   - **(B) fallback** — a single horizontally-scrolling chip strip
     (`flex overflow-x-auto` + `snap-x`, `whitespace-nowrap`, no wrap) one row tall. Use
     only if the sheet causes issues; A is preferred because it fully removes the list.
2. **Fix the row itself in `App.tsx`:** change the selector wrapper from `items-center` to
   `items-start`, cap its height to one row, and remove its ability to grow. Make
   `ModeToggle` + `DivisionSelector` + the new pose chip sit on **one line**
   (`flex-wrap` allowed only as a last resort to a 2nd line, never a tall stack).
3. **Make the camera + score the dominant region.** In posing mode the mobile `<main>`
   grid must give the camera the lion's share. Set the mobile grid rows so the camera
   fills (`grid-rows-[1fr_auto]` with the camera row `min-h-0 flex-1`), and surface the
   `PosingPanel` (Pose / Symmetry / Hold + ScoreRing) **directly under or overlaid on the
   camera**, not buried in the tabbed aside. On mobile, default the visible panel to the
   score readout so the “detector” the user cares about is always on screen.
4. **Desktop (`lg`) unchanged** — keep the current two-column `1fr_360px` layout; gate all
   the above to below `lg`.

### Acceptance (measure it, don't eyeball)
- Posing mode at 393×852: `getBoundingClientRect().height` of the camera container +
  `[data-testid="posing-panel"]` **≥ 70% of `window.innerHeight`**.
- The selector wrapper's height **≤ 56px**; no pose pill is visible until the user opens
  the picker.
- No black gap taller than ~8px between the header/selector and the camera.
- Changing division still resets the pose to that division's first mandatory
  (`selectDivision` untouched); all `data-testid`s (`pose-*`, `mode-*`, `division-select`)
  preserved.

### Verify
- `cd frontend && npx vitest run && npx eslint .` → green. Extend `PoseSelector.test.tsx`:
  default render shows **no** pose pills (collapsed), opens on trigger click, collapses on
  select, hint no longer rendered inside the selector.
- Playwright at 320, 375, 393, 430 × portrait AND 852×393 landscape: assert the
  camera+score ≥ 70% rule above, and assert selector height ≤ 56px. This is the
  pass/fail gate for P21.
- Manual on the actual iPhone (the device in the screenshot): open Posing → the pose list
  is gone, only the chosen pose chip shows, and the camera + score fill the screen.

---

## P22 — Camera-first layout for ALL modes; ancillary panels float, not stack

> Applies to **every exercise and both modes** (Exercise + Posing) — not posing-only.
> P21 fixes the posing selector; P22 fixes the *panels below the camera* that shrink the
> tracking view everywhere.

### Observed on production (Exercise/Squat, iPhone, screenshot 22:18)
The selector row is already compact (good). But under the camera there is a **permanent
vertical stack**: the `Coaching | Chat` tab bar, the full **FORM SCORE /100** panel, the
**"Position yourself in frame"** cue (shown both as an overlay *and* again in the panel),
and a **REFERENCE VIDEO — Squat** row. This stack takes ~half the height, so the camera /
pose-tracking view is only a small band. The user's feedback: *the tracking screen is not
maximized; the position-yourself guidance and the reference video should be floating
windows over the camera, not full stacked blocks.*

### Principle (camera is always the hero)
The live camera + its on-frame HUD (reps, ScoreRing, worst-joint, coaching caption — all
already drawn by `CameraHud` / `PoseOverlay`) is the primary surface in every mode. Lean on
that overlay and **demote everything else to floating / on-demand**, so the camera fills the
available space instead of sharing it with stacked cards.

### Changes
1. **Maximize the camera.** On mobile, the camera container should fill the main area
   (`flex-1 min-h-0`) in both modes — target the camera + its HUD ≥ **70% of viewport
   height**, same rule as P21. Remove the fixed-height feel; let it grow.
2. **"Position yourself in frame" → overlay only, no duplication.** It already renders on
   the camera via `EmptyStageHint` / `CameraHud`. Remove the duplicate text inside the
   FORM SCORE panel so the same message is not shown twice and does not add panel height.
   Keep it as a floating caption centered on the camera until a body is detected.
3. **Reference Video → floating, collapsed by default.** Replace the always-present
   `ReferenceVideoPanel` block with a small **button/FAB** (e.g. a "▷ Reference" pill on the
   camera or in the action bar). Tapping opens the reference clip as a **floating overlay /
   bottom-sheet over the camera**, dismissible. It must not occupy a permanent stacked row.
4. **Form score → compact, prefer the on-camera HUD.** The ScoreRing + reps already live on
   the camera HUD. On mobile, collapse the separate FORM SCORE card into a thin strip (score
   number + top cue) docked at the bottom of the camera, OR fold it into the overlay — do
   not give it a tall standalone card. The detailed `CoachingCues` / `ChatPanel` stay behind
   the existing `Coaching | Chat` tabs, but those tabs sit **below** a now-dominant camera,
   not beside a small one.
5. **Generalize, don't special-case.** This layout (camera fills, ancillary floats) is the
   default for all 7 exercises and for posing. No per-exercise layout branches.
6. **Desktop (`lg`) unchanged** — the two-column `1fr_360px` layout keeps the side panels
   visible; gate the float/collapse behavior to below `lg`.

### Acceptance
- In Exercise mode (any of the 7) AND posing mode at 393×852, the camera + its HUD
  ≥ **70% of `window.innerHeight`**; no permanent reference-video or duplicate-cue block
  remains in the scroll flow.
- "Position yourself in frame" appears **once**, as a camera overlay.
- Reference video is reachable in ≤ 1 tap and opens as a floating overlay, then dismisses.
- All existing `data-testid`s preserved; tests pass.

### Verify
- `cd frontend && npx vitest run && npx eslint .` → green. Update
  `ReferenceVideoPanel.test.tsx` (now launched from a trigger) and `CoachingCues` tests
  (duplicate cue removed).
- Playwright at 320/375/393/430 portrait + 852×393 landscape, in **both** Exercise and
  Posing: assert camera+HUD ≥ 70% height and that the reference panel is not in the
  document until its trigger is tapped.
- Manual on the actual iPhone: Squat view shows a big camera, a one-tap floating reference,
  and no stacked half-screen of cards.

---

## P23 — Division (category) switch must be visible & reachable in posing  ⟵ ACTIVE GOAL

### Observed on production (posing, iPhone, screenshot 09:04)
P21 collapsed the pose picker into a `CollapsibleSelect` sheet, with the `DivisionSelector`
passed in as `extra` and rendered **above** the pose grid inside the sheet. On the phone the
top of that sheet is **clipped under the app header**, so the division dropdown
("Men's Open Bodybuilding" → other divisions) is partially hidden and effectively
unreachable. The user can change the *pose* but cannot find or tap the control to change the
*division / category*. The control exists in the DOM (`DivisionSelector`) — it is a
**visibility / placement** bug, not a missing feature.

### Root cause
- The opened sheet (`CollapsibleSelect`) does not reserve top spacing for the fixed app
  header / safe-area, so its first child (`extra` = the division control) sits beneath the
  header and is cut off.
- The division control also has no visible label in the sheet, so even when partly shown it
  reads as just another pill rather than "this is how you switch division."

### Changes
1. **`CollapsibleSelect.tsx`** — when open as a mobile sheet, pad the top so content starts
   **below** the header + notch: `padding-top: max(<header-height>, env(safe-area-inset-top))`
   (or anchor the sheet under the header, not under the status bar). Make the sheet body
   scrollable (`overflow-y-auto`, `max-h`) so nothing is unreachable.
2. **`PoseSelector.tsx`** — give the `extra` block a clear heading inside the sheet, e.g. a
   small `Division` label above the dropdown, visually separated from the pose grid
   (a divider or a sub-section). It must be the first thing the user sees when the sheet
   opens.
3. **(Recommended) surface division in the collapsed row too.** Add a compact division chip
   to the always-visible selector row next to the mode toggle, e.g. `Open ⌄`, so the user
   can switch category **without** opening the pose sheet at all. Tapping it opens the same
   division choices. This directly answers "I couldn't find where to switch category."
4. Keep `selectDivision` behavior (switching division resets pose to that division's first
   mandatory) and all `data-testid`s (`division-select`, `pose-*`) intact.

### Acceptance
- In posing mode on iPhone, the **Division control is fully visible and tappable** — either
  in the collapsed selector row (preferred) or at the top of the opened sheet, never clipped
  by the header/notch.
- A first-time user can switch from "Men's Open Bodybuilding" to another division in ≤ 2
  taps and clearly sees it is the category switch (labeled).
- Switching division updates the pose lineup and resets to the first mandatory.

### Verify
- `cd frontend && npx vitest run && npx eslint .` → green. Extend `PoseSelector.test.tsx` /
  add `CollapsibleSelect.test.tsx`: the division control renders, is labeled, and is not
  positioned under the header (assert it is inside the scrollable sheet body).
- Playwright at 375/393 portrait: open posing → assert `[data-testid="division-select"]`
  (or the new division chip) is in the viewport and clickable.
- Manual on the actual iPhone (09:04 screenshot device): open Posing, confirm you can find
  and change the division without hunting.

---

## Done = all five green on a real iPhone

The goal board is complete when, on the actual phone:
1. **P19** — both action bars reachable, nothing clipped by notch/home-indicator; fluid
   across the 320 → 1024px+ matrix.
2. **P20** — camera flip is one comfortable thumb tap.
3. **P21** — in posing mode the camera + score occupy ≥ 70%, the pose list is collapsed to
   a single chip, no dead space up top.
4. **P22** — in EVERY mode the camera is the hero (≥ 70%); the "position yourself" cue and
   reference video are floating/on-demand, not stacked blocks.
5. **P23** — the division / category switch is visible and reachable in posing without
   hunting; switching it updates the pose lineup.

Keep working this board top-to-bottom until every Acceptance + Verify box above is checked.
**P23 is the currently active goal** — P21/P22 landed; this is the remaining
in-production issue (see screenshot 09:04: division control clipped under the header).
