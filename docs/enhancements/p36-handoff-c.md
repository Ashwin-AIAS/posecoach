# P36 Lane C Hand-off Notes (`feat/p36c-home-ai`)

## 1. Tasks Completed / Skipped

All Lane C tasks (**C1–C8**) are complete; none were skipped.

- **C1 — Fix Home rings (`StatTile`):** Added `frontend/src/features/home/StatTile.tsx` using `--accent` for count rings (weekly sessions vs goal of 4, streak vs 7) with accessible labels (`"8-day streak"`, `"X of 4 sessions this week"`). Kept `ScoreRing` exclusively for **Avg form** (did not edit `ScoreRing.tsx`).
- **C2 — "Today" hero on Home:** Redesigned `frontend/src/components/Home.tsx` around a `Today` hero card backed by `GET /api/v1/history/recommendation` (with cold-start / signed-out fallback `"Start with <Exercise>"`), added `frontend/src/features/home/WeekStrip.tsx` (7 Mon–Sun dots + streak pill), upgraded recent sessions to §0.4 cards coloured and labelled by form quality (`Good form` / `Fair form` / `Needs work`), and kept all required testids (`start-workout-btn`, `coach-ai-btn`, `home-rings`, `recent-strip`, `recent-strip-item`).
- **C3 — Deterministic insight cards:** Added pure, unit-tested `frontend/src/lib/insights.ts` (`computeHomeInsights`, `getLastExercise`, `getWorstTrendingExercise`) computing trend per exercise, neglected movement (≥ 7 days), and weekly consistency (max 2 cards on Home), each with an `"Ask Coach"` button.
- **C4 — Coach AI polish:** Updated `frontend/src/components/ChatPanel.tsx` and `frontend/src/components/CoachAiSheet.tsx`: removed the duplicated starter-prompt row, removed emoji from welcome copy, made the single suggestion-chip row history-aware (worst-trending + last exercise), added optional `initialPrompt` prefill, and enabled the `"Coach knows your last 5 sessions"` header chip when signed in (backed by C7).
- **C5 — Empty states:** Upgraded empty states in `frontend/src/components/WorkoutPanel.tsx` (empty state only), `frontend/src/components/DiaryDay.tsx` (empty state only; verified `BudgetSummary` renders with zero entries / all-zero totals), and `ChatPanel.tsx` (signed-out callout while keeping text input usable).
- **C6 — First-run onboarding:** Added `frontend/src/features/onboarding/Onboarding.tsx` and `storage.ts` — 3 skippable steps (Goal, static SVG phone-setup illustration without touching camera, First exercise) persisted under `localStorage["pc.onboarding.v1"]`.
- **C8 — Brand layer:** Added `frontend/src/features/brand/brand.ts` and `Wordmark.tsx` (product name unchanged: `PoseCoach`), added a 300ms reduced-motion-safe first-paint fade on `#root` in `frontend/src/index.css`, and updated `frontend/src/components/TabBar.tsx` active state to a filled pill behind the icon.
- **C7 — Backend Coach AI session memory:** Updated `app/api/v1/chat.py` to load the authenticated user's last 5 `WorkoutSession` rows server-side via the httpOnly `access_token` cookie (`get_user_from_cookie_optional`), format a ≤ 400-char summary injected into the system prompt, skip the shared answer cache for personalized turns, ignore any client-sent context fields, and never log the summary. Added SQLite in-memory tests in `tests/test_chat_memory.py`.

---

## 2. Wiring Requests for Integration (`frontend/src/App.tsx` — owned by Lane A)

Lane C did not edit `App.tsx` or `ScoreRing.tsx`. Please apply the following 4 wiring updates during §4 integration:

1. **Mount `<Onboarding>` on first run (`pc.onboarding.v1`):**
   - Import `Onboarding` from `./features/onboarding/Onboarding` and `readOnboarding` from `./features/onboarding/storage`.
   - State: `const [showOnboarding, setShowOnboarding] = useState(() => readOnboarding() === null)`
   - Render:
     ```tsx
     {showOnboarding && (
       <Onboarding
         defaultExercise={exercise}
         onComplete={(state) => {
           setExercise(state.firstExercise)
           setShowOnboarding(false)
         }}
       />
     )}
     ```
2. **Insight card `"Ask Coach"` → open `CoachAiSheet` prefilled:**
   - State: `const [coachInitialPrompt, setCoachInitialPrompt] = useState<string | null>(null)`
   - Pass to `<Home>`:
     ```tsx
     onAskCoach={(prompt) => {
       setCoachInitialPrompt(prompt)
       setCoachAiOpen(true)
     }}
     ```
   - Pass to `<CoachAiSheet>`:
     ```tsx
     <CoachAiSheet
       exercise={exercise}
       initialPrompt={coachInitialPrompt}
       onSignIn={() => {
         setCoachAiOpen(false)
         setTab("settings")
       }}
       onClose={() => {
         setCoachAiOpen(false)
         setCoachInitialPrompt(null)
       }}
     />
     ```
3. **Swap header wordmark for `<Wordmark>`:**
   - Import `Wordmark` from `./features/brand/Wordmark`.
   - Replace the inline `<h1>Pose<span className="text-accent">Coach</span></h1>` in the Coach header with `<Wordmark />`.
4. **Live-view `ChatPanel` auth/memory props (optional):**
   - Where `ChatPanel` is mounted inside the live tray/aside, optionally pass `authed={Boolean(auth.user)}` so the `"Coach knows your last 5 sessions"` chip also appears in the live-view chat header.

---

## 3. `data-testid` Changes

**Preserved (unchanged):**
- `home-view`, `home-rings`, `start-workout-btn`, `coach-ai-btn`, `recent-strip`, `recent-strip-item`
- `coach-ai-sheet`, `coach-ai-close`, `chat-open-btn`, `chat-panel`, `chat-messages`, `chat-input`, `chat-frame-btn`, `quick-replies`, `quick-reply-chip`
- `workout-panel`, `start-workout-cta`, `browse-exercises-btn`, `diary-day`, `daily-totals`, `diary-empty`, `diary-empty-add`
- `tab-bar`, `tab-coach`, `tab-workouts`, `tab-calories`, `tab-settings`

**New:**
- Home: `today-hero-card`, `week-strip`, `week-dot-0`..`week-dot-6`, `week-streak-badge`, `stat-sessions`, `stat-sessions-value`, `stat-streak`, `stat-streak-value`, `home-insights`, `insight-card`, `insight-ask-coach`
- Coach AI: `coach-memory-chip`, `coach-signed-out-empty`, `coach-sign-in-btn`
- Workouts empty state: `workouts-empty`, `workouts-empty-cta`
- Onboarding: `onboarding-flow`, `onboarding-skip`, `onboarding-step-1`, `onboarding-step-2`, `onboarding-step-3`, `onboarding-goal-<id>`, `onboarding-phone-illustration`, `onboarding-ex-<exercise>`, `onboarding-back`, `onboarding-next`, `onboarding-finish`
- Brand / TabBar: `brand-wordmark`, `tab-pill-coach`, `tab-pill-workouts`, `tab-pill-calories`, `tab-pill-settings`

---

## 4. Gate Output & Screenshots

### Frontend (`D:\Projects\CollegeMaterials\pc-lane-c\frontend`)
- `npx tsc --noEmit`: **0 errors**
- `npx eslint . --max-warnings=0`: **0 errors, 0 warnings**
- `npx vitest run`: **Test Files 96 passed (96) | Tests 614 passed (614)**
- `npm run build`: **✓ built in 19.28s** (PWA service worker generated)

### Backend (`D:\Projects\CollegeMaterials\pc-lane-c`)
- `ruff check app/`: **All checks passed!**
- `mypy app/ --strict`: **Success: no issues found in 75 source files**
- `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`: **850 passed** (Total coverage on `app/analysis`: **97.68%**)

### Visual Screenshots (port `5183`)
- Folder: `D:\Projects\CollegeMaterials\pc-lane-c\.shots\lane-c`
- Verified at both **390×844 (@2x)** and **1440×900** (authed + anon) across Home, Coach AI sheet, Workouts empty state, Calories empty state + BudgetSummary, and TabBar pill indicator — no overlaps, clipping, or contrast issues. (Note: the existing `ScoreRing` square glow behind "Avg form" is owned by Lane A / A3.)

---

## 5. Human Real-Phone Checks
- Verify 300ms first-paint fade feels smooth on cold PWA launch and is disabled with iOS/Android Reduce Motion enabled.
- Verify horizontal scroll of Recent sessions strip and tap targets (≥ 44×44px) on 390px and 375px screens.
- After integration wiring: verify `<Onboarding>` appears once on a clean `localStorage`, persists `pc.onboarding.v1`, and pre-selects the chosen exercise.
- After integration wiring: verify tapping `"Ask Coach"` on an insight card opens `CoachAiSheet` with the question pre-filled, and signed-in chat responses reflect the user's last 5 sessions.
