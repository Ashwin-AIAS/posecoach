# P36 Lane A Hand-Off Notes (`feat/p36a-live`)

## 1. Tasks Done / Skipped

| Task | Status | Summary |
|---|---|---|
| **A1. Remove the double HUD** | Done (`75cd917`) | Stopped calling `drawStatusLine`, `drawLegend`, `drawCornerBrackets`, and `drawCueChip` in `PoseOverlayNeon.tsx` so the DOM `CameraHud.tsx` is the single source of UI chrome while the canvas draws skeleton, joints/arcs, grid/vignette, and scan band only. |
| **A2. Give the camera the screen** | Done (`c3dfadf`) | Replaced the live-view page header + stacked selector row with a compact floating top bar (`<header data-testid="selector-row">`) over `camera-stage`: back button, single-pill `ExerciseSelector` (with `ModeToggle` folded into its portaled picker sheet), mute toggle, and compact `UserMenu` overflow menu (History, email, Sign in / Log out). Camera stage covers ~93% of the 390×844 phone viewport (target ≥ 85%). |
| **A3. HUD readable from the mirror** | Done (`f0fc3ed`) | Bumped rep hero numeral to `72px` (`text-[4.5rem]`, `font-display`, `animate-number-pop`); added `form-colour-frame` 3–4px inset glow (`src/features/live/formFrame.ts`) easing over 300ms along the score ramp (green ≥ 80, amber ≥ 60, red < 60, neutral when null/blocked); resized `CameraHud` `ScoreRing` to `88px`; styled lower-third coaching cue at `≥ 20px` (`text-xl`, `line-clamp-2`); fixed `ScoreRing` square glow clipping via `overflow-visible` SVG + 2px stroke-inset radius. |
| **A4. Rep feedback pulse** | Done (`01c48e0`) | Added `src/lib/haptics.ts` (`navigator.vibrate?.(15)` with iOS/desktop feature-detected no-op and `localStorage` persistence under `pc.haptics.v1`). On every rep increment, `CameraHud` triggers a scale pulse + electric-accent flash on `form-colour-frame` and fires haptics when enabled. Added haptics toggle (`data-testid="haptics-toggle"`) next to voice mute in the floating top bar. |
| **A5. Set-start countdown** | Done (`1ede602`) | Added `src/features/live/SetCountdownOverlay.tsx` (3-2-1 countdown overlay with `"Start now"` skip button, reduced-motion safe) and a `"Start set"` trigger (`data-testid="start-set-btn"`) in the bottom action bar that gates the HUD and calls `stats.reset()` on completion. |
| **A6. Tidy** | Done (`3b6ecaf`) | Replaced `?` text glyphs in `CameraHud.tsx` and `ExerciseSelector.tsx` with Lucide `CircleHelp` (44×44px tap target on HUD); styled floating triggers and action-bar CTAs to §0.4; inset mobile `PosingPanel compact` (`left-16 right-16`) so it never collides with bottom-left `CircleHelp` or bottom-right `flip-camera`. |

No Lane A tasks were skipped.

---

## 2. Wiring Requests for Integration (§4)

Lane A owns `src/App.tsx`. No files outside the Lane A column of §0.3 were modified. During §4 integration on `feat/p36-premium`:
1. **Apply Lane B hand-off wiring in `src/App.tsx`:**
   - Pass `recording={recorder.lastRecording}` to `<SessionSummary>` and suppress `<RecordingPreview>` while `summary !== null`.
   - Pass `onStart={() => { setShowHistory(false); setView("live") }}` to `<HistoryPanel>`.
2. **Apply Lane C hand-off wiring in `src/App.tsx`:**
   - Mount `<Onboarding>` when `pc.onboarding.v1` is unset.
   - Wire Home insight card `"Ask Coach"` action to open `<CoachAiSheet>` with a prefilled query.
   - Swap the Home `<header>` wordmark for `<Wordmark>` from `src/features/brand/Wordmark.tsx`.
3. **Playwright E2E note for §4 integration (`responsive-mobile.spec.ts`):**
   - `ModeToggle` (`data-testid="mode-posing"`, `data-testid="mode-exercise"`) is now folded inside the `ExerciseSelector` picker sheet per A2. Any e2e test that clicks `mode-posing` from the live view should click `exercise-change-btn` first to open the picker sheet, then click `mode-posing`.

---

## 3. `data-testid` Inventory (Preserved, Moved, and New)

### Preserved Existing `data-testid`s
- `back-home-btn`, `voice-toggle`, `flip-camera`, `finish-set-btn`, `record-btn`, `prep-btn`
- `tray-trigger`, `reference-trigger`, `coach-ai-trigger`
- `selector-row` (now on the compact floating `<header>` over `camera-stage` in the live view)
- `camera-stage`, `latency-badge`, `rec-indicator`
- `exercise-change-btn` (now the unified exercise pill trigger), `exercise-current-label`, `exercise-search`
- `mode-exercise`, `mode-posing` (now rendered inside `ExerciseSelector`'s picker sheet when `onModeChange` is supplied)
- `signin-btn`, `history-btn`, `user-email`, `logout-btn` (inline on Home header; inside the overflow menu in the live view floating top bar)
- `rep-counter`, `ring-score-value`, `worst-joint-chip`, `mismatch-banner`, `status-banner`

### New `data-testid`s Added in Lane A
- `overflow-menu-btn`, `overflow-menu` (`src/components/UserMenu.tsx` compact mode)
- `form-colour-frame` (`src/components/CameraHud.tsx` — exposes `data-band`, `data-tint`, `data-rep-pulse`)
- `rep-hero-number` (`src/components/CameraHud.tsx` — 72px hero rep numeral, exposes `data-rep-pulse`)
- `hud-top-cue` (`src/components/CameraHud.tsx` — ≥20px 2-line lower-third coaching caption)
- `hud-howto-btn` (`src/components/CameraHud.tsx` — 44×44px bottom-left `CircleHelp` button)
- `haptics-toggle` (`src/App.tsx` — rep vibration toggle next to `voice-toggle`)
- `start-set-btn` (`src/App.tsx` — triggers the 3-2-1 countdown overlay)
- `set-countdown-overlay`, `set-countdown-value`, `set-countdown-skip` (`src/features/live/SetCountdownOverlay.tsx`)

---

## 4. Gate Output & Screenshot Folder

- **Typecheck (`npx tsc --noEmit`):** `0 errors`
- **Lint (`npx eslint . --max-warnings=0`):** `0 warnings, 0 errors`
- **Unit tests (`npx vitest run`):**
  ```
  Test Files  95 passed (95)
       Tests  603 passed (603)
    Duration  40.90s
  ```
- **Production build (`npm run build`):**
  ```
  ✓ 2149 modules transformed.
  ✓ built in 6.94s
  PWA v0.20.5 — precache 10 entries (1099.90 KiB)
  ```
- **Visual screenshots (port `5181`, 390×844 @2x and 1440×900):**
  `D:\Projects\CollegeMaterials\.shots\lane-a` (`28 PNGs` verified at 390px and 1440px: no canvas/DOM HUD text overlap, no ScoreRing square glow artefact, camera stage dominates ≥85% of the phone viewport).

---

## 5. On-Device Phone Verification Checklist (Human)

1. **Haptics (`navigator.vibrate(15)`):** Verify tactile pulse on rep increments on Android Chrome (and confirm clean no-op on iOS Safari), plus the top-bar haptics toggle (`pc.haptics.v1`).
2. **2-Metre Mirror Readability & Countdown:** Tap `"Start set"`, walk back to the mirror during the `3-2-1` countdown overlay, and confirm the `72px` rep counter, `3–4px` form-colour stage frame, and `20px` lower-third cue are legible from 2 metres.
3. **Safe-Area Top Inset:** Confirm the floating top bar (`marginTop: env(safe-area-inset-top)`) clears the iOS Dynamic Island / notch in standalone PWA mode.
