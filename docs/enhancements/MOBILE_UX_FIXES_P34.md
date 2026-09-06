# P34 — Mobile UX Fixes: Safe-Area Headers, Active-Workout Back, Barcode Scanner

> Executable prompt for Claude Code. Frontend-only, additive, appearance +
> component behavior. Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first.
> Pose core stays frozen. Can ship independently or fold into P30's frontend build.

- **Owner:** Claude Code
- **Branch:** `feat/p34-mobile-ux-fixes`
- **Depends on:** nothing new (pure frontend); compatible with P30
- **New thesis metric:** none (product/usability) — but directly lifts SUS
  (unreachable back button + non-working scanner are the two loudest usability
  complaints from device testing 2026-07-23).

---

## Why P34 exists (device test, iPhone PWA, 2026-07-23)

Two confirmed defects:

1. **Panel headers ignore `env(safe-area-inset-top)`.** The Coach tab wraps its
   content in a `<header>` with `paddingTop: max(0.375rem, env(safe-area-inset-top))`
   (`App.tsx:252`). The **Workouts / Calories / Settings** tabs render their
   panels with no such wrapper, and each panel's own header uses plain padding
   (`WorkoutPanel.tsx:304` landing, `:281` library sub-view; `ActiveWorkout.tsx:106`;
   `CaloriesPanel.tsx` / `SettingsPanel.tsx`). On a notched device the header
   renders under the status bar — the title overlaps the clock (visible in test
   screenshots), and on sub-views the **back control is under the notch and
   unreachable**. Reported as "couldn't go back, the back option was hiding."
2. **Active-workout screen has no back affordance.** `ActiveWorkout` header
   (`:106`) has only a "Finish" button — leaving the screen requires *ending*
   the workout. There is no "collapse to Workouts, keep session running" exit.
3. **Barcode scanner never decodes on iOS.** Confirmed failure mode: camera
   opens (video visible, HTTPS PWA — secure context fine), but pointing at a
   barcode does nothing. `BarcodeScanner.tsx:60` calls `decodeFromConstraints`
   with `{ video: { facingMode: "environment" } }` — **no resolution or focus
   hint**, so iOS supplies a low-res stream where EAN/UPC bars are too few
   pixels to decode. No native `BarcodeDetector` fast-path either.

---

## Open decisions — confirm or reframe before running

1. Fix headers by adding the top inset **per-panel** (WorkoutPanel landing +
   library sub-view header, ActiveWorkout header, CaloriesPanel, SettingsPanel),
   matching the Coach header's `max(0.375rem, env(safe-area-inset-top))`. (A
   shared wrapper in `App.tsx` is the alternative but touches the frozen-ish
   shell more — per-panel is the smaller diff.) OK?
2. Active-workout back = a left-side control in the header that returns to the
   Workouts landing **without finishing** (session already persists via
   `pc.activeWorkout.v1` + server; "Resume workout" brings it back). "Finish"
   stays as the explicit end. OK?
3. Scanner strategy: **`BarcodeDetector` when present** (Android/Chrome — fast,
   reliable), **zxing fallback** (iOS Safari) with hardened constraints
   `{ width:{ideal:1920}, height:{ideal:1080}, facingMode:{ideal:"environment"} }`
   + continuous focus via `applyConstraints({ advanced:[{focusMode:"continuous"}] })`
   when supported. Optional torch toggle if `track.getCapabilities().torch`. OK?

---

## Goal / Definition of Done

1. On a notched iPhone, every tab's header (and its back button) clears the
   status bar; no title/clock overlap.
2. From an active workout the user can return to the Workouts landing without
   finishing, then resume; "Finish" still ends and offers save-as-routine.
3. Barcode scanning decodes a real retail EAN/UPC on an installed iPhone PWA
   within a couple of seconds of framing it; Android uses the native detector.
4. Existing tests pass; new behavior covered; `tsc`/eslint clean; pose core
   untouched. Playwright layout check for the header insets.

---

## Stage A — Safe-area headers + active-workout back (frontend-only)

- Add `style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}` to the
  outer header/container of: WorkoutPanel landing header, WorkoutPanel library
  sub-view header, ActiveWorkout header, CaloriesPanel root, SettingsPanel root.
  Keep existing bottom insets.
- ActiveWorkout: add a left-aligned back control (ChevronLeft, `min-h-11 w-11`,
  `aria-label="Back to workouts"`) that calls a new `onMinimize` prop → App
  sets the Workouts sub-view back to landing while leaving the workout in
  `workoutLog` + localStorage (so "Resume workout" reappears). Do **not** call
  `onFinish`. TabBar already unhides when `workoutActive` is false — flip that
  via `onActiveWorkout(false)` on minimize.
- **Gate:** vitest — minimize returns to landing and workout still resumable;
  finish still ends. Playwright — with a mobile viewport + simulated inset, the
  back button's box is fully below the inset (not clipped). `tsc`/eslint clean.
- Commit: `[P34] fix: safe-area top insets on tab headers + active-workout back`

## Stage B — Barcode scanner hardening (frontend-only)

- `BarcodeScanner.tsx`: feature-detect `window.BarcodeDetector`
  (`await BarcodeDetector.getSupportedFormats()` includes `ean_13`) → use it on
  a `requestVideoFrameCallback` loop over a manually-started high-res
  `getUserMedia` stream. Else fall back to the existing zxing reader.
- Both paths use hardened constraints: `{ video: { facingMode:{ideal:"environment"},
  width:{ideal:1920}, height:{ideal:1080} } }`; after the stream starts, best-effort
  `track.applyConstraints({ advanced:[{focusMode:"continuous"}] })` (guarded —
  unsupported throws, ignore).
- Optional: if `track.getCapabilities?.().torch`, render a small torch toggle
  over the frame (`applyConstraints({ advanced:[{torch:true}] })`).
- Keep the release-on-unmount / `visibilitychange` lifecycle. Keep `onDecoded`
  dedupe. Keep the manual-entry fallback path in `CaloriesPanel` unchanged.
- Make "not found" vs "lookup error" copy distinct in `CaloriesPanel` (already
  separate modes — verify the messages read clearly so a valid-but-unknown code
  doesn't look like a scanner failure).
- **Gate:** vitest — BarcodeDetector path mocked (decodes → `onDecoded`), zxing
  fallback path mocked, constraint-apply failure is swallowed. Manual device
  check: scan a real barcode on iPhone PWA. `tsc`/eslint clean.
- Commit: `[P34] feat: barcode scanner — BarcodeDetector fast-path + hi-res zxing fallback`

End with PR to `main`, then STOP.

---

## Guardrails specific to P34

- Frozen pose-core untouched — the barcode scanner is already independent of the
  pose-camera hooks; keep it that way (its own `getUserMedia`, its own stream).
- Additive: new props (`onMinimize`) with safe defaults; no existing prop
  behavior changed. Dark-only, English-only. No JWT/localStorage rule affected.
- `App.tsx` edits limited to: pass `onMinimize` to WorkoutPanel/ActiveWorkout
  wiring — do not alter the Coach branch.
