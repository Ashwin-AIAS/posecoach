# P36 — Premium Elevation: 3 Parallel Lanes

> One plan, three agents running at the same time. Each terminal runs **one lane** in its
> **own git worktree** on its **own branch**, and owns a **separate set of files**, so the
> lanes never edit the same file. A short integration step at the end wires them together.
>
> Source: frontend audit of 2026-11-27 (Playwright screenshots at 390px and 1440px).

---

## 0. Read this first (every lane)

### 0.1 Override for this work
`GEMINI.md`/`CLAUDE.md` still say "every feature must map to a thesis metric". **That rule does
not gate P36.** This is commercial product polish. Every other rule still applies:
TypeScript strict, no `any`, Tailwind only, no third-party UI libraries, no JWT in
`localStorage`, `requestAnimationFrame` for camera loops, `playsInline` on `<video>`,
`React.memo` on components fed by WebSocket data, structlog on the backend.

### 0.2 Frozen files — no lane touches these
- `frontend/src/hooks/usePoseStream.ts`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/hooks/useCamera.ts`
- `frontend/src/lib/hudRenderer.ts` (the recording compositor; it must keep matching what users saw)
- Everything under `app/inference/`, `app/analysis/`, `app/api/v1/ws_inference.py`
- `frontend/playwright.config.ts`, `frontend/package.json` (**no new dependencies**)

### 0.3 File ownership (the rule that makes parallel work safe)
A lane may **only create or edit** files in its own column. It may **import** any file
read-only. If a lane needs a change in a file it doesn't own, it writes the request into
its hand-off notes (§5) instead of making the edit.

| Lane A — Live camera | Lane B — After the set & progress | Lane C — Home, Coach AI, brand |
|---|---|---|
| `src/App.tsx` (**only lane allowed**) | `src/components/SessionSummary.tsx` | `src/components/Home.tsx` |
| `src/components/CameraHud.tsx` | `src/components/RecordingPreview.tsx` | `src/components/RecommendationCard.tsx` |
| `src/components/ScoreRing.tsx` | `src/components/HistoryPanel.tsx` | `src/components/ChatPanel.tsx`, `ChatMessage.tsx`, `CoachAiSheet.tsx` |
| `src/components/CameraFeed.tsx`, `EmptyStageHint.tsx` | `src/components/HistoryTrend.tsx`, `WorkoutDetail.tsx` | `src/hooks/useChat.ts` |
| `src/components/ExerciseSelector.tsx`, `ModeToggle.tsx` | `src/components/ProgressionChart.tsx` | `src/components/WorkoutPanel.tsx` (empty state only) |
| `src/components/UserMenu.tsx` | `src/components/ui/Sparkline.tsx` | `src/components/CaloriesPanel.tsx`, `DiaryDay.tsx` (empty state only) |
| `src/components/PoseOverlay.tsx` | `src/hooks/useSessionStats.ts` | `src/components/TabBar.tsx` |
| `src/features/coach/overlay/**` | `src/hooks/useSessionRecorder.ts` | `tailwind.config.js`, `src/index.css` (**only lane allowed**) |
| `src/lib/haptics.ts` (new) | `src/features/summary/**` (new) | `src/features/home/**`, `src/features/onboarding/**`, `src/features/brand/**` (new) |
| `src/features/live/**` (new) | `src/lib/setInsights.ts`, `src/lib/shareCard.ts` (new) | `src/lib/insights.ts` (new) |
| tests for the above | tests for the above | `app/api/v1/chat.py`, `app/chatbot/**` (C7 only), tests |

**Shared styles:** only Lane C edits `tailwind.config.js`/`index.css`. Lanes A and B use
existing tokens. If they need a new keyframe, they put it in a lane-local CSS file
(`src/features/live/live.css`, `src/features/summary/summary.css`), following the
`features/voice/voice.css` precedent.

**Public interfaces stay backward-compatible.** New props must be **optional**, and
existing props and `data-testid`s must not be renamed or removed, because existing e2e
specs depend on them.

### 0.4 Shared visual spec (all lanes follow it, so the lanes stay consistent without a shared file)
- **Primary CTA:** `rounded-full min-h-12 px-6 bg-accent text-surface-base font-semibold`, with the existing spring press (`active:scale-[0.97]`).
- **Secondary:** `rounded-full min-h-11 bg-surface-raised shadow-elev-1 text-gray-200`.
- **Cards:** `rounded-2xl bg-surface-raised shadow-elev-1` (elev-2 for hero cards). No hairline borders.
- **Section labels:** keep the existing `text-xs uppercase tracking-[0.18em] text-gray-500`.
- **Numbers:** `font-display hud-numerals`.
- **Colour meaning:** green, amber and red are **only** for form quality. Counts (reps, sessions, streaks, kcal) use `accent` or white, **never** the score ramp.
- **No emoji in UI copy.** Use Lucide icons.
- **Motion:** 150–300ms, spring easing, and respect the existing `prefers-reduced-motion` block.
- **Tap targets:** ≥ 44×44px.

### 0.5 Gates (run before every commit in your lane)
```bash
cd frontend
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run
npm run build
```
Lane C, if C7 touched the backend, must also pass `ruff check app/ && mypy app/ --strict && pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`.

**Visual check (required for every UI task):**
```bash
# terminal-local dev server on YOUR lane port (A=5181, B=5182, C=5183), never 5173
npm run dev -- --port 5181 --strictPort        # run in background
PORT=5181 OUT=../.shots/lane-a node scripts/ui-shots.cjs
```
Open the PNGs and check them at 390px **and** 1440px. Look for overlap, clipping, dead
space and contrast problems. Unit tests can't catch those problems; screenshots catch them.

**Do NOT run `npx playwright test` inside a lane.** Its config reuses whatever server is on
:5173, so lanes would test each other's code. Full e2e runs once, in integration (§4).

### 0.6 Commits
Format: `[P36A] feat: short description` (or `P36B` / `P36C`; types feat/fix/refactor/test/docs/chore).
Make one small commit per task. **Never push, never merge, never `git push hf`.** The human merges.

---

## 1. Lane A — Live camera experience  (branch `feat/p36a-live`)

Goal: the camera view is what your reels show. It should look clean and be readable from
2 metres away at a mirror.

**A1. Remove the double HUD (fix).** The neon overlay draws canvas HUD chrome:
`drawStatusLine` ("POSECOACH · LIVE FORM ENGINE"), `drawLegend` and corner brackets, called
from `features/coach/overlay/PoseOverlayNeon.tsx`. The DOM `CameraHud.tsx` draws the rep
chip and score ring in the same corners, and the two overlap.
→ Keep the **DOM HUD** as the single source of UI chrome, and make the canvas overlay draw
only skeleton, joints, grid/vignette and the scan band. Delete or stop calling the
overlapping canvas text. Done = no text overlaps in `phone-*-03-live.png` /
`desktop-*-03-live.png`.

**A2. Give the camera the screen (fix).** On a 390px phone, the header (wordmark +
"History"/"Log out" text links + mute) plus the selector row use ~200px.
→ In the live view, replace the header with a compact floating top bar over the camera:
back button, exercise name pill (tap opens the existing `ExerciseSelector`), mute and an
overflow menu (History, account). Fold Exercise/Posing (`ModeToggle`) into that picker
sheet. Target: the camera stage covers **≥ 85%** of the 390×844 viewport. Keep all
existing `data-testid`s on the same controls (`back-home-btn`, `voice-toggle`,
`flip-camera`, `finish-set-btn`, `record-btn`, `tray-trigger`, `reference-trigger`,
`coach-ai-trigger`, `selector-row`, `camera-stage`).

**A3. HUD readable from the mirror.**
- One hero number: reps at ≥ 72px on phone (`font-display`), with the existing `number-pop` on change.
- **Form-colour frame:** a 3–4px inset glow on the camera stage edge, tinted with the score ramp (green ≥ 80, amber ≥ 60, red < 60, neutral when there's no score). Ease between colours over 300ms; never flash.
- Make `ScoreRing` a compact secondary readout (≈ 88px) instead of the 128px corner block.
- Top cue as a large lower-third caption (≥ 20px, max 2 lines). Keep the "Fix: <body part>" chip, but stop it colliding with the top bar.
- Fix the `ScoreRing` square glow artefact (visible behind the 75 ring on Home). Props stay backward-compatible.

**A4. Rep feedback pulse.** On every rep increment: a short scale pulse on the rep number,
a brief accent flash on the form frame, and `navigator.vibrate?.(15)` via a new
`src/lib/haptics.ts` (a feature-detected no-op on iOS). Add a toggle for haptics next to
mute (persist in `localStorage` under `pc.haptics.v1` — not auth data, so allowed).

**A5. Set-start countdown.** "Start set" shows a 3-2-1 overlay (big numerals, reduced-motion
safe) so the user can walk back to the mirror. Rep counting itself is unchanged (it's
frozen). The countdown only gates the UI, and `stats.reset()` is called when it ends.

**A6. Tidy.** Replace the `?` text glyph with a Lucide `CircleHelp` icon. Make the floating
trigger column match §0.4. Re-check the posing-mode layout (`PosingPanel compact`) after
A2.

**Tests:** vitest for the colour frame (score → tint mapping), the haptics no-op path, the
countdown → reset, and that the DOM HUD renders while the canvas status line no longer does.

---

## 2. Lane B — After the set & progress  (branch `feat/p36b-after-set`)

Goal: the end of a set is the payoff, and the part people share.

**B1. Fix "Best" (bug).** `SessionSummary.tsx:108` computes
`Math.max(...trend, stats.bestScore)`, where `trend` is history from *every* exercise. A
0-rep set showed "Best 90". → "Best" = best rep score **of this set** (`stats.bestScore`).
If you want history, show it as a separate "Personal best (Squat)" figure computed only
from this exercise's sessions. Add a regression test.

**B2. Celebration + set insights.** Redesign the summary as a full-height sheet:
- A hero rep count with a count-up animation, plus a one-line verdict ("Clean set", "Good set — watch your knees", "Form broke down late").
- **Set insights**, computed **deterministically** in new `src/lib/setInsights.ts` (no LLM, no network) from `repScores`, worst joint and history: e.g. "Reps 5–6 dropped to 58 — fatigue?", "Avg 81, +6 vs your last Squat", "Most consistent set this week". Give 2–3 insights at most, each ≤ 12 words, in plain English. Pure functions, fully unit-tested.
- Keep the effort buttons and per-rep bars (restyle them to §0.4).
- A brief celebration pulse when avg ≥ 80, or when it's a personal best (reduced-motion safe; CSS only, no canvas confetti library).

**B3. Shareable result card.** Add new `src/lib/shareCard.ts`, which renders a 1080×1920
PNG on an offscreen canvas: exercise, reps, avg form, per-rep bars, date, and a "PoseCoach"
wordmark (text only). Add a "Share" button that uses `navigator.share({ files })` where
supported and falls back to download. It runs **on-device only**: no upload, no camera
frames in the card.

**B4. Rep replay (needs a recording).**
- `useSessionStats`: add `repTimesMs: readonly number[]` (wall-clock ms for each counted rep) to `SessionStats`. This is additive.
- `useSessionRecorder`: add `startedAtMs: number` to `RecordedSession`. This is additive.
- `SessionSummary`: new **optional** prop `recording?: RecordedSession | null`. When present, tapping a rep bar plays the recording from `repTimesMs[i] - startedAtMs - 1500ms` for ~3s inside the summary. When absent, the bars aren't tappable and the summary shows a hint: "Tap Record before a set to replay reps".
- Don't edit `App.tsx` (Lane A owns it). Write the one-line wiring into your hand-off: pass `recording={recorder.lastRecording}`, and don't open `RecordingPreview` while the summary is open.

**B5. History screen polish.** `HistoryPanel`/`WorkoutDetail`/`HistoryTrend`: use §0.4
cards, show per-exercise personal bests, and give the empty state an icon, one line and a
"Start a set" CTA. Use a new optional `onStart?: () => void` prop and note the wiring in
your hand-off.

**Tests:** setInsights (table-driven), Best fix, repTimesMs bookkeeping, a shareCard smoke
test (canvas mocked), and the replay seek-time maths.

---

## 3. Lane C — Home, Coach AI, onboarding, brand  (branch `feat/p36c-home-ai`)

Goal: the app feels like a coach that knows you, from the first screen.

**C1. Fix the Home rings (bug).** Sessions = 1 and streak = 8 render as **red "bad"
rings** with `aria-label="Form score 8 of 100"`, because `ScoreRing` is a form-score
component. → Build `src/features/home/StatTile.tsx` (or `ActivityRing.tsx`) for counts:
accent colour, a correct aria-label ("8-day streak"), and a goal-based fill (e.g. sessions
vs a weekly goal of 4). Keep `ScoreRing` only for "Avg form". Don't edit `ScoreRing.tsx`
(Lane A owns it).

**C2. "Today" hero on Home.** Replace the greeting + three rings with:
- A **Today card**: the recommended exercise and target from `GET /api/v1/history/recommendation` (it already exists; `RecommendationCard` already calls it), e.g. "Squat · 4×9 · focus: knees", with one primary CTA "Start". On a cold start (204) or when signed out, show "Start with Squat" and a short explainer.
- A **week strip**: 7 day dots (Mon–Sun), filled on days with a session; the streak is shown here.
- Recent sessions as §0.4 cards, with each score coloured by form quality and labelled.
- Fill the dead space below the fold with C3's insight cards.
- The existing `start-workout-btn`, `coach-ai-btn`, `home-rings`, `recent-strip` and `recent-strip-item` testids must still exist (`home-rings` can move to the new stat row).

**C3. Insight cards.** New `src/lib/insights.ts`: deterministic, pure, unit-tested.
Compute from the history list: trend per exercise ("Deadlift form +9 over 2 weeks"),
neglected movement ("No bench in 10 days"), consistency ("4 sessions this week — best
yet"). Show at most 2 cards on Home. Each card has a "Ask Coach" action that opens Coach
AI pre-filled with the question.

**C4. Coach AI polish.**
- Remove the duplicated suggestion-chip row (there are two sets today) and remove the emoji.
- Make the suggestions context-aware: use the last exercise and worst-trending exercise from history.
- Add a "Coach knows your last 5 sessions" chip in the header when signed in (only once C7 has landed; otherwise hide it).
- Keep the streaming indicator and bubble animation.

**C5. Empty states.** Workouts, Calories and Coach AI signed-out: each gets an icon, a
one-sentence value line and a primary CTA, per §0.4. The Calories day view must render the
budget summary even with zero entries (check `DiaryDay` with an empty `entries` and an
all-zero `totals`).

**C6. First-run onboarding.** New `src/features/onboarding/Onboarding.tsx`, three
skippable steps:
1. Goal (build muscle / lose fat / move better / compete — posing).
2. "Set up your phone": an illustration of phone placement and distance, plus a full-body silhouette guide. Use a static illustration; **don't open the camera here** (`useCamera` is frozen and Lane A owns the live view).
3. Pick a first exercise.

Store completion and the goal in `localStorage` (`pc.onboarding.v1` — not auth data).
Don't mount it in `App.tsx`. Write the wiring into your hand-off.

**C7. (Backend, optional — do it last.) Coach AI memory.** When the request is
**authenticated**, `app/api/v1/chat.py` loads the user's last 5 `WorkoutSession` rows
server-side and adds a ≤ 400-char summary of them (exercise, date, avg score, reps) to the
system prompt.
- Never trust a client-sent context field.
- Never log the summary.
- Exclude it from the answer cache key (or skip the cache for personalised answers).
- Add pytest with an in-memory SQLite fixture covering the signed-in vs anonymous paths.

**C8. Brand layer — don't rebrand.** Don't rename the product or invent a logo; that's a
founder decision. Instead:
- Move the wordmark into `src/features/brand/Wordmark.tsx`, and gather the brand colour and name into one place (`--accent` in `index.css` already exists), so a future rebrand is a one-file swap.
- Add a 300ms branded splash/fade on first paint (reduced-motion safe).
- Make the tab bar active state a filled pill behind the icon instead of a 2px line.

**Tests:** insights and StatTile aria/colour (table-driven), onboarding step flow and
persistence, the Today card cold-start path, chat chip de-duplication, and the C7 pytest.

---

## 4. Integration (after all three lanes report done)

Run this in **Terminal A**, because Lane A owns `App.tsx`. You can also ask Claude to run it
as a short review session.

```bash
git checkout feat/p36-premium            # integration branch
git merge --no-ff feat/p36a-live         # 1st: owns App.tsx
git merge --no-ff feat/p36b-after-set    # 2nd
git merge --no-ff feat/p36c-home-ai      # 3rd: also owns tailwind/index.css
```
Then apply every hand-off wiring note (`docs/enhancements/p36-handoff-*.md`). The expected
ones are:
- `SessionSummary recording={recorder.lastRecording}` (and suppress `RecordingPreview` while the summary is open).
- `HistoryPanel onStart`.
- Mount `<Onboarding>` when `pc.onboarding.v1` is unset.
- Insight card "Ask Coach" → open `CoachAiSheet` with a prefilled query.
- Swap the header wordmark for `<Wordmark>`.

Gates: all of §0.5, plus **full Playwright** `cd frontend && npx playwright test` (fix specs
that assert on moved UI, and keep testids where possible), plus `ui-shots.cjs` on :5181
for a final visual pass. Then the human reviews and opens a PR.

---

## 5. Hand-off notes (each lane writes one when finished)
Create `docs/enhancements/p36-handoff-<a|b|c>.md` containing:
- tasks done / skipped (and why);
- **wiring requests** for files you don't own (exact component, prop, value);
- new `data-testid`s and any moved ones;
- gate output (paste the summary lines) and the screenshot folder path;
- anything a human must verify on a real phone (haptics, share sheet, camera framing).

---

## 6. One-time setup (human, before opening the 3 terminals)

Worktrees are created from **committed** code, so commit the Gemini/agents setup and this
plan first; otherwise the lanes won't see them.

```bash
cd "D:/Projects/CollegeMaterials/GYMVISION AI"
git add GEMINI.md GEMINI.local.md AGENTS.md .agents .gemini \
        docs/enhancements/PREMIUM_ELEVATION_P36.md frontend/scripts/ui-shots.cjs .gitignore
git commit -m "[P36] docs: premium elevation lane plan + gemini agent setup"
git branch feat/p36-premium

git worktree add ../pc-lane-a -b feat/p36a-live       feat/p36-premium
git worktree add ../pc-lane-b -b feat/p36b-after-set  feat/p36-premium
git worktree add ../pc-lane-c -b feat/p36c-home-ai    feat/p36-premium

for d in a b c; do (cd ../pc-lane-$d/frontend && npm ci); done
```
Lane C only, if doing C7: copy `.env` into `../pc-lane-c/` and set up the Python env there.
Worktrees don't include gitignored files.

Then open three terminals: `cd ../pc-lane-a` → `gemini`, `cd ../pc-lane-b` → `gemini`,
`cd ../pc-lane-c` → `gemini`, and paste the matching prompt from §7.

Cleanup after merging: `git worktree remove ../pc-lane-a` (repeat for b and c).

---

## 7. Terminal prompts (paste one per terminal)

### Terminal A
```
You are Lane A of a 3-agent parallel job. Read docs/enhancements/PREMIUM_ELEVATION_P36.md
fully, especially §0 (rules, frozen files, file ownership, visual spec, gates). Execute
§1 tasks A1–A6 in order, in THIS worktree on branch feat/p36a-live.
Hard limits: edit ONLY files in the Lane A column of §0.3; never touch frozen files;
no new npm dependencies; never run `npx playwright test`; dev server only on port 5181.
For each task: read the current code first, implement, add/adjust vitest tests, run the
§0.5 gates, take screenshots with `PORT=5181 OUT=../.shots/lane-a node scripts/ui-shots.cjs`
and look at them at 390px and 1440px, then commit as `[P36A] <type>: <desc>`.
Never push or merge. If a task needs a file you don't own, don't edit it: record it in
docs/enhancements/p36-handoff-a.md. When all tasks are done, write that hand-off file
per §5 and stop.
```

### Terminal B
```
You are Lane B of a 3-agent parallel job. Read docs/enhancements/PREMIUM_ELEVATION_P36.md
fully, especially §0 (rules, frozen files, file ownership, visual spec, gates). Execute
§2 tasks B1–B5 in order, in THIS worktree on branch feat/p36b-after-set.
Hard limits: edit ONLY files in the Lane B column of §0.3 (you may NOT edit App.tsx,
tailwind.config.js, or index.css); never touch frozen files; no new npm dependencies;
never run `npx playwright test`; dev server only on port 5182. All new props must be
optional and all SessionStats/RecordedSession changes additive.
For each task: read the current code first, implement, add vitest tests (B1 needs a
regression test), run the §0.5 gates, take screenshots with
`PORT=5182 OUT=../.shots/lane-b node scripts/ui-shots.cjs` and look at them, then commit as
`[P36B] <type>: <desc>`. Never push or merge. Record App.tsx wiring needs in
docs/enhancements/p36-handoff-b.md. When done, write that hand-off file per §5 and stop.
```

### Terminal C
```
You are Lane C of a 3-agent parallel job. Read docs/enhancements/PREMIUM_ELEVATION_P36.md
fully, especially §0 (rules, frozen files, file ownership, visual spec, gates). Execute
§3 tasks C1–C6 and C8 in order, then C7 (backend) last and only if everything else is
green. Work in THIS worktree on branch feat/p36c-home-ai.
Hard limits: edit ONLY files in the Lane C column of §0.3 (you may NOT edit App.tsx or
ScoreRing.tsx); never touch frozen files; no new npm dependencies; never rename the product
or invent a logo; never run `npx playwright test`; dev server only on port 5183. Keep the
existing Home data-testids listed in C2.
For each task: read the current code first, implement, add vitest tests (pytest for C7,
with SQLite in-memory, never real Postgres), run the §0.5 gates (plus ruff/mypy --strict/
pytest for C7), take screenshots with `PORT=5183 OUT=../.shots/lane-c node scripts/ui-shots.cjs`
and look at them, then commit as `[P36C] <type>: <desc>`. Never push or merge. Record
App.tsx wiring needs in docs/enhancements/p36-handoff-c.md. When done, write that hand-off
file per §5 and stop.
```
