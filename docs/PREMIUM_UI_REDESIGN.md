# PoseCoach — Premium UI Redesign (Apple Fitness–inspired)

> **Purpose of this file.** A single source of truth for turning PoseCoach's
> current "functional but ordinary" frontend into an Apple Fitness–grade premium
> experience — *without* cloning Apple's proprietary assets, and *without*
> touching the pose engine, scoring, or chat logic. It contains (1) the design
> review, (2) the design direction + tokens, (3) a per-screen plan, and (4) a
> sequence of self-contained Claude Code prompts, each with a hard
> "Definition of Done" and a mandatory commit-and-push step.

- **Status:** Planning → ready to execute.
- **Branch:** `main`
- **GitHub remote:** `origin` → https://github.com/Ashwin-AIAS/posecoach.git
- **Hugging Face remote:** `hf` → https://huggingface.co/spaces/Ashwintaibu/posecoach (backend only)
- **Scope:** Frontend re-skin + motion. No backend behaviour changes expected.
- **Audience for v1:** Myself, then friends. Startup only if it lands.

---

## 0. Ground rules (read before any prompt)

These are **hard constraints**. Every prompt inherits them.

1. **Re-skin, do not rebuild.** Keep existing components, hooks, state, and the
   pose/scoring/chat logic. We change *appearance and motion*, not behaviour.
2. **Keep the design tokens that already work** (see §2). Extend them; don't
   replace the system.
3. **Not an Apple clone.** Apple-grade *polish and principles*, PoseCoach's own
   identity. No Apple icons, no SF Pro, no pixel-copies of Apple screens.
4. **No emoji as UI controls.** Use a real icon set (Lucide).
5. **Mobile-first.** This is used mid-workout with a phone on the floor. The live
   screen must be glanceable. Desktop is the secondary layout.
6. **OneDrive caveat (for the human, not Claude Code):** the repo lives in
   OneDrive. Claude Code runs locally on Windows and writes normally — this only
   matters for the Cowork assistant's Edit/Write tools, not for Claude Code.
7. **Don't break tests.** When a re-skin changes markup that a Vitest test
   asserts on, update the test in the *same* prompt. Never delete a test to make
   it pass.
8. **Accessibility stays.** Keep `aria-*`, `role`, `prefers-reduced-motion`
   handling, and keyboard focus states.

---

## 1. Design review (current state)

### What's already good (keep it)
- Proper near-black surface system: `base #0A0B0D → raised #15171C → overlay #1B1E24 → hairline #23262D`.
- Single swappable electric-blue accent (`--accent: 61 155 255`) via CSS var.
- Semantic score ramp: red `#FF4D4D` → amber `#FFB23D` → green `#36D399`.
- Tabular numerals for HUD figures (`.hud-numerals`).
- Real type pairing: Space Grotesk (display) + Inter (body).
- `backdrop-blur` already used in the header (glass direction is started).
- `prefers-reduced-motion` already respected.

**Verdict:** the *tokens* are right. This is a finishing problem, not a
foundation problem. Roughly 30% of the way to Apple-grade; the missing 70% is
surface polish + motion, not re-architecture.

### What makes it read as "ordinary" (fix it)
1. **Everything is outlined, nothing is elevated.** Hairline borders on header,
   toolbar, buttons, cards → reads as a wireframe/utility dashboard. Apple uses
   **elevation** (soft shadow + raised background + blur), almost never visible
   borders.
2. **Emoji icons** (🔄 🔊 🔈, record dot) instantly cheapen the UI.
3. **The ScoreRing is too thin and too quiet.** 8px stroke + faint shadow = a
   gauge. It's the most recognizable element and should be the showpiece: thick
   (14–18px), gradient arc, count-up number, a "snap" on rep completion.
4. **Flat hierarchy, no scale contrast.** Everything is ~the same size and
   tightly packed. Apple's premium feel = dramatic scale (huge numbers, tiny
   labels) + generous negative space.
5. **Minimal motion.** Small fades + a pulse dot only. Apple's polish is ~50%
   motion: spring easing, ring-fill celebrations, smooth number transitions.
6. **Desktop-shaped layout** (`lg:grid-cols-[1fr_360px]`, right sidebar) for a
   tool that's used on a phone mid-set.

---

## 2. Design direction & tokens

### Principles (the "Apple-similar" feel, our identity)
- **Black is the canvas.** Pure dark background; let one or two colors pop.
- **Elevation over outline.** Separate layers with shadow + blur, not borders.
- **Scale contrast.** Big confident numbers, small quiet labels.
- **Breathing room.** Generous padding; never cram.
- **Motion with intent.** Spring easing; celebrate milestones (reps, goals).
- **Glanceability first** on the live screen — readable at 2 metres.

### Tokens to KEEP (do not change)
- Surface scale, accent CSS var mechanism, score ramp colors, font pairing,
  tabular-nums utility, reduced-motion media query.

### Tokens to ADD/CHANGE
- **Elevation utilities** (new `boxShadow` levels): `elev-1`, `elev-2`, `elev-3`
  (progressively larger, softer, darker shadows) to replace most hairline borders.
- **Card surface treatment:** raised background + subtle inner highlight
  (`inset 0 1px 0 rgba(255,255,255,0.04)`) + `elev-2`, rounded `2xl`/`3xl`.
- **Gradient ring stroke:** an SVG `linearGradient` along the accent/score ramp
  for the ScoreRing arc.
- **Spring easing tokens:** e.g. `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`
  plus Tailwind `transitionTimingFunction` entries.
- **Type scale additions:** a `display-hero` size (≥ 64px) for big stat numbers.
- **Icon system:** `lucide-react` (already allowed). No emoji controls.
- **Optional accent gradient:** a 2-stop gradient derived from `--accent` for hero
  surfaces / progress fills (kept subtle, not rainbow).

---

## 3. Per-screen plan

### A. Live Workout / Camera HUD  ← signature screen, design it as its own thing
Apple gives the *least* useful inspiration here (Apple is passive video; you are
real-time feedback). Treat it like a **car dashboard / HUD**:
- One dominant glanceable signal: the big score ring + a single color state.
- Rep count and exercise name large; everything else recedes.
- Coaching cue as a large, calm caption (not a dense list) — one cue at a time.
- Minimal chrome over the camera; controls reachable with a thumb.
- Worst-joint highlight stays, but styled as a soft glow, not a hard outline.

### B. AI Coach Chat (RAG)
Make it feel like a real, premium messaging surface:
- Bubbles with elevation, clear user/coach distinction, comfortable spacing.
- Streaming text with a tasteful typing indicator.
- "Coach is looking at your form" affordance when a frame snapshot is attached.
- Quick-reply chips for common questions; smooth auto-scroll.

### C. History & Progress  ← Apple patterns transfer best here
- Apple-style **summary cards**: big number + label + trend sparkline.
- Weekly/period rings or bars; per-exercise breakdown.
- Tap a session → detail with the per-rep timeline you already have.

### D. Home / Dashboard (new hub)
- Greeting + today's snapshot rings (sessions, avg form, streak).
- "Resume / Start workout" primary CTA, large and inviting.
- Recent sessions strip; one tap into the live screen or history.

---

## 4. Execution prompts (run in order)

**How to use:** paste one prompt at a time into Claude Code. Each prompt is a
*goal with a Definition of Done (DoD)* — Claude Code must **loop until every DoD
checkbox and every verification command passes**, then run the **Wrap-up
protocol** (§5) to commit and push. Do not start the next prompt until the
current one is pushed.

> Numbering: `UI-00 … UI-10`. Commit tag format: `[UI-0X] type: summary`.

---

### PROMPT UI-00 — Foundation: icons, elevation, motion tokens
```
GOAL
Lay the premium design foundation without changing any screen's behaviour:
install the icon set, add elevation + spring-motion tokens, and a reusable
Card + gradient-ring gradient def. This prompt is plumbing only.

DO
1. Add `lucide-react` to frontend deps (npm install lucide-react).
2. In tailwind.config.js add boxShadow levels `elev-1/2/3` (soft, layered,
   black-based) and a `transitionTimingFunction` entry `spring`
   (cubic-bezier(0.34,1.56,0.64,1)). Keep all existing tokens.
3. In index.css add `--ease-spring` and a `display-hero` helper if needed.
4. Create `src/components/ui/Card.tsx`: a raised, rounded-2xl surface using
   elevation (NOT a hairline border) + subtle inset top highlight. Typed, no `any`.
5. Create `src/components/ui/Icon.tsx` (thin wrapper around lucide-react with a
   consistent default size/strokeWidth) so the rest of the app imports icons
   from one place.
6. Do NOT yet refactor existing screens — just add the primitives.

DEFINITION OF DONE (loop until ALL true)
[ ] `npm install` succeeds; lucide-react in package.json + lock.
[ ] `cd frontend && npx tsc --noEmit` passes (no type errors).
[ ] `cd frontend && npx eslint src --max-warnings=0` passes.
[ ] `cd frontend && npx vitest run` passes (no existing test broken).
[ ] `cd frontend && npm run build` succeeds.
[ ] Card and Icon components exist, are typed, and have no `any`.

VERIFY
Run all five commands above and paste the passing output before wrap-up.
```
Wrap-up: §5. Backend changed? **No** → push to GitHub only.

---

### PROMPT UI-01 — Replace every emoji control with Lucide icons
```
GOAL
Remove all emoji used as UI (🔄 flip, 🔊/🔈 voice, record dot, and any others)
and replace with Lucide icons via the Icon wrapper. Premium, consistent icons.

DO
1. Grep the frontend for emoji used as controls/affordances. Replace each with a
   semantically correct Lucide icon (e.g. RefreshCw/SwitchCamera, Volume2/VolumeX,
   Circle/Dot for record, etc.).
2. Keep all aria-labels/titles intact; icons get aria-hidden where a label exists.
3. Ensure focus-visible rings and hover states still read well.
4. Update any Vitest test that asserted on emoji text to assert on the icon's
   accessible name / test id instead.

DEFINITION OF DONE (loop until ALL true)
[ ] No emoji remain as interactive controls (grep clean).
[ ] tsc --noEmit, eslint (0 warnings), vitest run, npm run build all pass.
[ ] Every control still has an accessible name (aria-label/title preserved).

VERIFY
Paste passing output of tsc, eslint, vitest, build. Paste the grep result
showing no control emoji remain.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-02 — Elevation system: borders → depth
```
GOAL
Replace hairline-border separation with elevation across header, toolbar,
buttons, and panels so the UI reads as floating layers, not a wireframe.

DO
1. Audit usages of `border-surface-hairline` (and ad-hoc borders). Convert
   container/cards to the Card primitive or to bg-raised + elev-2 (+ optional
   inset highlight). Keep borders ONLY where a 1px divider is genuinely needed.
2. Header/toolbar: use raised translucent bg + backdrop-blur + elev, not borders.
3. Buttons: pill surfaces with elevation + hover lift (subtle translateY) instead
   of outline-only styling. Keep accent state for active toggles.
4. Maintain contrast/legibility on pure-black background.

DEFINITION OF DONE (loop until ALL true)
[ ] Visible hairline borders reduced to intentional dividers only.
[ ] tsc, eslint(0), vitest, build all pass.
[ ] No layout regressions (grid/flex structure preserved).

VERIFY
Paste passing command output. List the components changed and why.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-03 — ScoreRing showpiece
```
GOAL
Turn ScoreRing into the signature element: thick gradient arc, count-up number,
and a subtle "snap"/pulse when the score crosses into a better band or a rep
completes. Pure SVG/CSS; must not run heavy work on the frame path.

DO
1. Increase stroke to ~14–18px; rounded caps; add an SVG linearGradient stroke
   that follows the score ramp (bad→mid→good) or accent for posing mode.
2. Animate the displayed number with a count-up/transition (respecting
   prefers-reduced-motion: snap instantly when reduced).
3. Add a gentle scale/glow "celebration" pulse on band-up / rep complete, gated
   by reduced-motion.
4. Keep the existing props/API (score, size, label) and the data-testid
   `ring-score-value`. Update ScoreRing.test.tsx if assertions change, without
   weakening coverage.

DEFINITION OF DONE (loop until ALL true)
[ ] Ring renders thick gradient arc; number counts up; celebration gated by
    reduced-motion.
[ ] Public props unchanged; data-testid preserved.
[ ] tsc, eslint(0), vitest, build all pass.

VERIFY
Paste passing command output. Confirm reduced-motion path snaps without animation.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-04 — Live Workout HUD: glanceable, mobile-first
```
GOAL
Redesign the live camera screen as a glanceable HUD (car-dashboard feel), not a
dense dashboard. Big score ring + rep count + exercise name dominate; one calm
coaching cue at a time; thumb-reachable controls; minimal chrome over camera.

DO
1. Establish scale hierarchy: large ring + large rep/exercise; secondary info
   recedes (smaller, lower contrast).
2. Show ONE primary coaching cue as a large calm caption (reuse CoachingCues data;
   collapse the list into a single highlighted cue with the rest available on tap).
3. Worst-joint highlight = soft accent glow, not a hard outline.
4. Mobile-first layout: controls within thumb reach; camera fills the viewport;
   panels (cues/chat/reference) become bottom sheets or tabs on small screens.
   Preserve desktop two-column as the >=lg layout.
5. Keep CameraFeed, PoseOverlay, CameraHud, recorder, and all hooks working.

DEFINITION OF DONE (loop until ALL true)
[ ] On a narrow viewport the live screen is glanceable: ring + reps + one cue
    dominate; no clutter over the camera.
[ ] Desktop layout still works (>=lg).
[ ] Camera, overlay, HUD, recording, finish-set all still function.
[ ] tsc, eslint(0), vitest, build all pass; affected tests updated.

VERIFY
Paste passing command output. Describe the mobile vs desktop layout behaviour.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-05 — AI Coach chat: premium messaging surface
```
GOAL
Make ChatPanel feel like a polished messaging app: elevated bubbles, clear
user/coach distinction, streaming typing indicator, quick-reply chips, smooth
auto-scroll, and a "looking at your form" affordance when a frame is attached.

DO
1. Restyle ChatMessage/ChatPanel: bubbles with elevation + comfortable spacing;
   coach vs user clearly differentiated; timestamps subtle.
2. Add a tasteful typing/streaming indicator during SSE streaming.
3. Add quick-reply chips for common questions (e.g. "How's my depth?",
   "Fix my back", "What muscles?") that send a preset message.
4. Smooth auto-scroll to newest; preserve scroll if user scrolled up.
5. Keep SSE streaming logic, useChat hook, and rate-limit behaviour unchanged.

DEFINITION OF DONE (loop until ALL true)
[ ] Chat looks like a premium messenger; streaming indicator works.
[ ] Quick-reply chips send correctly; no change to backend contract.
[ ] tsc, eslint(0), vitest, build all pass; affected tests updated.

VERIFY
Paste passing command output. Confirm SSE streaming still works against the
existing /chat/stream contract (no backend edits).
```
Wrap-up: §5. Backend changed? **No** (UI only) → GitHub only.
*(If you end up editing anything under `app/` — you shouldn't here — push to HF too.)*

---

### PROMPT UI-06 — History & Progress: Apple-style summary cards
```
GOAL
Redesign HistoryPanel / HistoryTrend into Apple-style summary cards: big number
+ label + trend sparkline, period grouping, per-exercise breakdown, and a tap-in
session detail that reuses the existing per-rep timeline.

DO
1. Build summary cards (Card primitive): e.g. Sessions, Avg form, Best streak,
   each with a sparkline/trend.
2. Restyle HistoryTrend chart to the premium dark aesthetic (grid-light, accent
   line/area, rounded).
3. Session list: elevated rows, tap → detail (reuse SessionSummary / per-rep
   timeline). Keep data fetching from /history unchanged.

DEFINITION OF DONE (loop until ALL true)
[ ] Summary cards + restyled trend render with real history data shape.
[ ] Empty/loading states handled gracefully.
[ ] tsc, eslint(0), vitest, build all pass; affected tests updated.

VERIFY
Paste passing command output. Confirm /history contract unchanged.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-07 — Home / Dashboard hub (new screen)
```
GOAL
Add a premium Home/dashboard as the app's entry hub: greeting + today's snapshot
rings (sessions, avg form, streak), a large "Start / Resume workout" CTA, and a
recent-sessions strip. Becomes the default view; live screen is one tap away.

DO
1. Create a Home view/route (or conditional top-level view) wired into App's
   existing state/navigation. Do not remove the live workout flow — link into it.
2. Snapshot rings reuse ScoreRing; stats pull from existing history/stats hooks.
3. Primary CTA navigates to the live screen with the last/selected exercise.
4. Keep auth gating consistent (UserMenu/useAuth).

DEFINITION OF DONE (loop until ALL true)
[ ] Home renders rings + CTA + recent sessions; CTA opens the live screen.
[ ] No existing flow removed; navigation back/forth works.
[ ] tsc, eslint(0), vitest, build all pass; new tests added for the Home view.

VERIFY
Paste passing command output. Describe the navigation model used.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-08 — Motion pass (the final 50%)
```
GOAL
Add intentional, performant motion across the app using the spring tokens:
view/card entrance, button press feedback, number transitions, ring celebration,
chat bubble in. All gated by prefers-reduced-motion.

DO
1. Apply spring easing + entrance transitions to cards/views/sheets.
2. Button press = subtle scale-down; hover = subtle lift.
3. Smooth transitions for changing numbers (reps, stats) and ring fills.
4. Keep it 60fps: transform/opacity only; no layout-thrashing animations; nothing
   heavy on the per-frame inference path.

DEFINITION OF DONE (loop until ALL true)
[ ] Motion present and consistent; everything disabled under reduced-motion.
[ ] No animation runs on the pose-frame render path.
[ ] tsc, eslint(0), vitest, build all pass.

VERIFY
Paste passing command output. Confirm reduced-motion disables all added motion.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-09 — Mobile-first responsive + PWA polish
```
GOAL
Ensure the whole app is excellent on a phone (the primary device): safe-area
insets, bottom nav/sheets, large tap targets, and PWA install/manifest polish.

DO
1. Audit every screen at 390px width. Fix overflow, tiny targets, cramped spacing.
2. Add safe-area-inset padding (notch/home indicator). Bottom navigation for the
   main sections (Home / Workout / Coach / History).
3. Verify manifest.json + installability; premium app icon/splash if missing
   (own branding, not Apple's).
4. Keep desktop layout intact at >=lg.

DEFINITION OF DONE (loop until ALL true)
[ ] All screens clean at 390px; tap targets >=44px; safe areas respected.
[ ] PWA installable; manifest valid.
[ ] tsc, eslint(0), vitest, build all pass; Playwright e2e (if present) green.

VERIFY
Paste passing command output. List any e2e specs run.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

### PROMPT UI-10 — Final QA + consistency sweep
```
GOAL
Polish and consistency: one shared spacing/radius rhythm, consistent icon sizes,
consistent card treatment, a11y check, and a clean production build.

DO
1. Sweep for inconsistent paddings/radii/shadows; unify to the token system.
2. a11y: focus-visible everywhere, color-contrast on dark bg, labels on all
   controls, reduced-motion verified.
3. Remove dead styles/unused imports.
4. Update README/screenshots if the project documents the UI.

DEFINITION OF DONE (loop until ALL true)
[ ] Consistent spacing/radius/shadow/icon system across all screens.
[ ] a11y checks pass (focus, contrast, labels, reduced-motion).
[ ] tsc, eslint(0), vitest, build all pass; e2e green if present.

VERIFY
Paste passing command output. Summarise what changed in the sweep.
```
Wrap-up: §5. Backend changed? **No** → GitHub only.

---

## 5. Wrap-up protocol (run at the END of every prompt)

Run this only after the prompt's Definition of Done is fully met and all verify
commands pass.

```bash
# 1. Quality gate (must pass — do not commit on red)
cd frontend
npx tsc --noEmit
npx eslint src --max-warnings=0
npx vitest run
npm run build
cd ..

# 2. Stage + commit (use the prompt's tag, e.g. [UI-03])
git add -A
git commit -m "[UI-0X] feat: <one-line summary of this prompt's change>

- bullet of what changed
- bullet of what changed"

# 3. ALWAYS push to GitHub (frontend hosting / source of truth)
git push origin main
```

### Push to Hugging Face ONLY if backend changed
Backend = anything under `app/`, `alembic/`, `requirements*.txt`, `Dockerfile*`,
or backend config. The UI prompts above should NOT touch these — if a prompt's
diff is purely `frontend/`, **skip this step**.

```bash
# Run ONLY when backend files changed in this prompt
# (HF Space is LFS-enabled; do git work on Windows per project rules)
git push hf main
```

**Decision rule per prompt:**
```
Did this prompt's git diff include app/ | alembic/ | requirements | Dockerfile?
  NO  -> git push origin main            (GitHub only)   <-- all UI-00..UI-10
  YES -> git push origin main && git push hf main        (GitHub + Hugging Face)
```

### Commit message convention
```
[UI-0X] type: short description (<=72 chars)

- bullet 1
- bullet 2
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

---

## 6. Definition of Done — whole redesign
- [ ] UI-00 … UI-10 all merged to `main` and pushed to GitHub.
- [ ] No emoji controls; Lucide icons throughout.
- [ ] Elevation-based depth; minimal intentional borders.
- [ ] ScoreRing is a gradient, animated showpiece.
- [ ] Live HUD is glanceable and mobile-first.
- [ ] Chat feels like a premium messenger.
- [ ] History uses Apple-style summary cards; Home hub exists.
- [ ] Consistent motion, gated by reduced-motion.
- [ ] Excellent at 390px; PWA installable.
- [ ] tsc / eslint(0) / vitest / build green on `main`.
- [ ] Pose engine, scoring, chat backend untouched (no HF push needed).
