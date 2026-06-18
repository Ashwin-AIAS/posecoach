# FIX — Camera Flip (Front → Back) Is Slow on Mobile

> Autonomous task brief for Claude Code. Self-contained. Work until **every**
> item in section 7 (Definition of Done) is checked. Do not stop at "looks fixed".

---

## 1. Problem (observed)

On a mobile phone, tapping the camera-flip control to switch from the **front
(user)** camera to the **back (environment)** camera takes a long, noticeable
time — the preview freezes for ~1–3 seconds before the back camera appears.
This breaks the real-time feel: the keypoint overlay should follow the user
immediately after a flip.

## 2. Root cause (already diagnosed — verify, don't re-investigate from zero)

In `frontend/src/hooks/useCamera.ts`:

1. **The back camera is requested at 1280×720** via the `ENVIRONMENT_SIZE`
   constant, while the front camera uses 640×480. On mobile, asking for a 720p
   sensor mode is the slow part of `getUserMedia()` — the browser negotiates a
   high-resolution capture pipeline. **This is the primary cost.**
2. **It buys nothing.** The capture/send pipeline downsamples every frame to
   320×240 (see `runner._decode_frame` / frontend capture profile) before it is
   sent over the WebSocket. The "cleaner downsample" comment on `ENVIRONMENT_SIZE`
   is not justified — the extra pixels are thrown away.
3. **No `switching` UI state.** `flip()` calls `stop()` (which sets `ready=false`
   and clears `srcObject`) and then awaits `getUserMedia()`. During that gap the
   UI shows a frozen/blank frame with no spinner, so the delay also *feels* worse
   than it is.

## 3. Goal

Switching front↔back on mobile should be **fast and feel instant**:
- Eliminate the unnecessary high-resolution request so `getUserMedia()` returns
  quickly.
- Show a clear "switching camera…" state during the unavoidable acquisition gap.
- Preserve the existing graceful fallback (desktops with a single camera must
  still work — `flip()` already restores the previous mode on failure).

## 4. Implementation steps

Touch **only** what is needed. Primary file: `frontend/src/hooks/useCamera.ts`.

1. **Drop the back-camera resolution to match the pipeline.**
   - Change `ENVIRONMENT_SIZE` from `{ width: 1280, height: 720 }` to the same
     profile the front camera uses (`{ width: 640, height: 480 }`), OR remove the
     special-case entirely and use `{ width, height }` for both facing modes.
   - Update the now-stale comment above the constant.
2. **Add a `switching` state.**
   - Add `readonly switching: boolean` to `UseCameraResult`.
   - Set it `true` at the start of `flip()` and `false` in both the success and
     fallback paths (use `try/finally` so it always clears).
   - Surface it so `App.tsx` can render a "Switching camera…" overlay/spinner on
     the video element while `switching` is true.
3. **(Optional, only if step 1 doesn't fully solve it) Switch by `deviceId`.**
   - Enumerate devices once (`navigator.mediaDevices.enumerateDevices()`), cache
     front/back `deviceId`s, and pass `{ deviceId: { exact } }` instead of
     `facingMode`. Some Android browsers acquire faster this way. Keep the
     `facingMode` fallback for browsers that don't expose labels/deviceIds before
     permission is granted.

## 5. Constraints (from project rules — do not violate)

- TypeScript **strict**; **no `any`** — use proper types or `unknown`.
- React: keep `useState`/`useReducer` local state; do not add external state libs.
- Camera loop stays on `requestAnimationFrame`, max 15 FPS — do not touch that.
- `<video>` must keep `playsInline` (iOS Safari) and `muted`/`autoPlay` as-is.
- CSS: Tailwind utility classes only for any new spinner/overlay; no inline styles
  except genuinely dynamic values.
- ESLint + Prettier must pass (`frontend/` config).
- **This repo lives in OneDrive** — file writes via some editors truncate. After
  editing, verify the file is intact (`wc -l`, and that the file ends cleanly).

## 6. Verification

- `cd frontend && npx vitest run` — all pass. Update/extend
  `src/__tests__/useCamera.test.ts` to cover: (a) `flip()` requests the same
  resolution for both modes (no 720p), (b) `switching` is true during the await
  and false after success, (c) `switching` clears on the fallback path too.
- `cd frontend && npx playwright test` — existing E2E still green.
- **Manual mobile check (required):** load the PWA on a phone, flip front→back and
  back→front several times. Confirm the switch is fast and the "switching…" state
  shows during the gap. The keypoint overlay must resume tracking immediately.

## 7. Definition of Done

- [x] Back camera no longer requested at 1280×720; both modes use the 640×480
      (pipeline) profile; stale comment updated.
- [x] `switching` state added, surfaced from the hook, and rendered as a spinner/
      overlay in `App.tsx` (via `CameraFeed`); always clears (success + fallback)
      via `try/finally`.
- [x] Desktop single-camera fallback still works (no regression in `flip()` catch).
- [x] `vitest` + `playwright` green; new tests cover the resolution and `switching`.
- [x] No `any`; ESLint clean; file verified non-truncated (120 lines, ends cleanly).
- [x] Manual mobile flip confirmed fast by a human (Ashwin) before marking done.

## 8. Out of scope

- On-device inference, WebSocket changes, capture FPS changes, model/latency work.
- Any backend (`app/`) change. This is a frontend-only fix.
