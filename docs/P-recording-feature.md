# PoseCoach — In-App Session Recording (Spec for Claude Code)

> **Goal:** Add a client-side **Record** button to the camera screen that captures a
> shareable video of a workout session — the camera feed **plus** the full tracking
> overlay (skeleton, keypoints, bones, arcs, motion trail, rep particles) **plus** the
> HUD (score ring, rep/hold counter, worst-joint chip, coaching cue) including its
> frosted-glass look. The clip is saved **locally on the user's device only** — never
> uploaded, never written server-side. Works on **mobile (phone camera)** and desktop.

---

## 1. Why this exists / scope

- Personal-tool + demo use: let people watch their own form back, and let me show
  demo clips to professors with the AI feedback baked in.
- **Capture scope chosen:** *Everything including the glass chips* — pixel-faithful to
  what's on screen, not just video + skeleton.
- This is no longer gated by the old "GDPR — never persist frames" thesis rule. Recording
  is **opt-in, on-device, user-initiated**, so it still respects the spirit: nothing leaves
  the device, nothing hits the server, no auto-capture.

---

## 2. The one hard architectural fact (read first)

What renders on screen is **three independent layers**, stacked with absolute positioning
inside the stage `<div>` in `frontend/src/App.tsx` (the `relative ... rounded-2xl` div, ~L158–178):

| Layer | File | Type | Holds |
|-------|------|------|-------|
| 1. Camera feed | `components/CameraFeed.tsx` | `<video>` | raw stream (may be CSS-mirrored on front cam) |
| 2. Tracking overlay | `components/PoseOverlay.tsx` | `<canvas>` | skeleton, bones, joints, arcs, trail, particles |
| 3. HUD | `components/CameraHud.tsx` | HTML/CSS DOM | score ring, reps/hold, worst-joint chip, cue caption |

**Consequence:** `captureStream()` on the existing `PoseOverlay` canvas would record *only
the skeleton on a transparent background* — no video, no HUD. To capture all three we must
**composite** them into one hidden recording canvas, then `MediaRecorder` records that canvas.

### Honest caveat on the "glass chips"
The HUD uses CSS `backdrop-blur` (frosted glass over live pixels). That is effectively
**not capturable at 30fps**:
- `html2canvas` / `html-to-image` do **not** support `backdrop-filter`, and snapshotting the
  DOM every frame is far too slow on a phone.
- So we **re-draw the HUD natively onto the compositor canvas** and *approximate* the glass:
  draw the chip's background region into an offscreen canvas, apply `ctx.filter = "blur(8px)"`,
  draw it back, then overlay a semi-transparent fill + hairline border + the text/numerals.
  This reads as the same frosted chip. Accept that it's a faithful re-creation, not a literal
  pixel copy of the CSS layer. **Do not** attempt per-frame DOM rasterization.

---

## 3. Design

### 3.1 New hook: `frontend/src/hooks/useSessionRecorder.ts`
Owns all recording state and the compositor loop.

```ts
interface UseSessionRecorderResult {
  readonly supported: boolean      // MediaRecorder + canvas.captureStream available
  readonly recording: boolean
  readonly elapsedMs: number       // for a live REC timer in the UI
  readonly start: () => void
  readonly stop: () => void        // finalizes + triggers local save
  readonly error: string | null
}

interface UseSessionRecorderOptions {
  readonly videoRef: React.RefObject<HTMLVideoElement>
  readonly overlayCanvas: () => HTMLCanvasElement | null  // from PoseOverlay (see 3.3)
  readonly drawHud: (ctx: CanvasRenderingContext2D, w: number, h: number) => void // see 3.4
  readonly mirrored: boolean        // mirror video to match front-cam display
  readonly fps?: number             // default 30, allow 24 on weak devices
}
```

Internals:
- A hidden `<canvas>` (the **compositor**), sized to the **video's intrinsic resolution**
  (`video.videoWidth/Height`) so the recording is sharp, not the on-screen CSS size.
- A `requestAnimationFrame` loop (capped to `fps`) that each frame:
  1. `ctx.save()`, apply horizontal flip if `mirrored`, `drawImage(video, ...)`, `ctx.restore()`.
     (Mirror the video the same way the live `<video class="mirror">` does, so left/right matches.)
  2. `drawImage(overlayCanvas(), 0, 0, w, h)` — scales the overlay canvas to the recording size.
     **Note:** the overlay draws in *display* (CSS px) coordinates but uses **normalized**
     keypoints internally, so scaling the whole canvas image is correct.
  3. `drawHud(ctx, w, h)` — native re-draw of the HUD chips (see 3.4).
- `stream = compositor.captureStream(fps)`; `new MediaRecorder(stream, { mimeType })`.
- Collect `dataavailable` chunks → on `stop`, `Blob` → object URL → trigger download (3.5).
- Clean up rAF + revoke object URL on unmount / stop.

### 3.2 Codec feature detection (mobile-critical)
Pick the first supported, in order:
```ts
const CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=h264",  // iOS Safari path
  "video/mp4",
]
const mimeType = CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
```
- `supported = typeof MediaRecorder !== "undefined" && mimeType !== "" && "captureStream" in HTMLCanvasElement.prototype`.
- File extension derives from the chosen mime: `.webm` vs `.mp4`.
- If unsupported (old iOS), hide the Record button and surface a one-line note.

### 3.3 Exposing the overlay canvas from `PoseOverlay.tsx`
The compositor needs a handle to the existing overlay canvas. Minimal change:
- Add an optional `onCanvasReady?: (c: HTMLCanvasElement | null) => void` prop, called in the
  mount effect with `canvasRef.current` (and `null` on cleanup). `App.tsx` stores it in a ref
  and passes a `() => ref.current` getter to the recorder. Do **not** restructure the rAF loop.

### 3.4 Native HUD re-draw — `frontend/src/lib/hudRenderer.ts` (new)
A pure function mirroring `CameraHud.tsx`'s layout, drawn on the compositor canvas:
- Helper `glassChip(ctx, x, y, w, h, radius)` → blur-sample underlying region + semi-transparent
  fill (`rgba(surface-base, 0.45)`) + hairline stroke. Reuse for every chip.
- Draw, matching `CameraHud` positions (scale offsets by recording size / display size):
  - Top-right: **score ring** (port `ScoreRing`'s arc math — value 0–100, color by band).
  - Top-left: **reps** counter, or **hold seconds** for plank (`exercise === "plank"`).
  - Top-center: **worst-joint chip** ("Fix: {bodyPart}") when present and not blocked.
  - Bottom-center: **coaching cue** caption (or center status banner when frame is blocked).
- Keep cue text ≤ the same wrapping width; ellipsize if needed.
- Pass the live `PoseResult` + `exercise` + `worst` into the renderer via a ref so it always
  draws the latest frame's values (same data `CameraHud` already receives in `App.tsx`).

### 3.5 Local save (incl. mobile share)
On `stop`:
```ts
const blob = new Blob(chunks, { type: mimeType })
const file = new File([blob], `posecoach-${exercise}-${Date.now()}.${ext}`, { type: mimeType })
// Prefer native share sheet on mobile (lets user save to Photos / Files):
if (navigator.canShare?.({ files: [file] })) {
  await navigator.share({ files: [file], title: "PoseCoach session" }).catch(() => downloadFallback(file))
} else {
  downloadFallback(file)   // <a download> + object URL, then revokeObjectURL
}
```

### 3.6 UI wiring in `App.tsx`
- Add a **Record / Stop** button in the stage toolbar row (next to **Finish set**, ~L139),
  disabled until `camera.ready` and only shown when `recorder.supported`.
- While recording: show a pulsing red dot + `mm:ss` (`recorder.elapsedMs`) overlaid top-left
  of the stage (use `pointer-events-none`). **Exclude this REC indicator from the capture**
  (it's chrome, not content) — i.e. draw it in the DOM only, not in `drawHud`.
- Stop recording automatically on `finishSet()` and on `camera.stop()` / tab hidden, so we
  never leave a dangling recorder when the camera releases.

---

## 4. Mobile / performance guardrails
- Compositing + encoding is extra CPU on a phone already running camera + WebSocket inference.
  Cap the recorder at **30fps** (allow falling back to 24). The pose WS stream and the live
  overlay rAF must keep priority — if you observe the live overlay stuttering during capture,
  lower the compositor fps before anything else.
- Size the compositor to `video.videoWidth/Height` (front cam ~640×480, back cam ~1280×720 per
  `useCamera.ts` `ENVIRONMENT_SIZE`). Do **not** record at full window size.
- Front camera is **mirrored** in the live `<video>` (`mirrored = facingMode === "user"`); the
  overlay already mirrors to match. Mirror the compositor's video draw identically so the
  recording matches what the user saw. Back camera is un-mirrored.
- iOS Safari: `.mp4/h264` only; `navigator.share` with files is the reliable save path there.

---

## 5. Privacy / rules compliance (keep these true)
- 100% client-side. **No** new server endpoint, **no** upload, **no** disk write server-side.
- Recording is **user-initiated and opt-in** only — never auto-start.
- Do not log frame bytes or the blob anywhere (`structlog` rules unaffected — this is frontend).
- The recorded file lives only where the user saves it (Photos / Files / Downloads).

## 6. Code-style rules (from `.claude/rules/code-style.md`)
- TS strict, **no `any`** (use `unknown` / proper types). PascalCase components, `useXxx` hooks.
- Tailwind utility classes for the button/indicator; inline style only for the dynamic timer.
- ESLint + Prettier clean.

---

## 7. Files
**New**
- `frontend/src/hooks/useSessionRecorder.ts` — recorder state + compositor loop.
- `frontend/src/lib/hudRenderer.ts` — native HUD/ glass-chip drawing for the canvas.
- `frontend/src/hooks/__tests__/useSessionRecorder.test.ts` — see §8.

**Modified**
- `frontend/src/components/PoseOverlay.tsx` — add `onCanvasReady` prop (one effect line).
- `frontend/src/App.tsx` — wire the hook, Record/Stop button, REC indicator, auto-stop hooks.
- (Optional) extract `ScoreRing` arc math into a shared helper if reused by `hudRenderer.ts`.

---

## 8. Tests (Vitest — `frontend`, see `.claude/rules/testing.md`)
jsdom lacks `MediaRecorder` / `captureStream`, so **mock them**:
- `supported` is `false` when `MediaRecorder` is undefined → button hidden.
- Codec picker returns the first `isTypeSupported`-true candidate; correct extension per mime.
- `start()` sets `recording`, creates a `MediaRecorder`, begins the rAF loop (fake timers);
  `stop()` flushes chunks, builds a `Blob`, and calls the share/download path (mock `navigator.share`).
- Auto-stop fires on `finishSet` / camera stop.
- Mirror flag flips the compositor draw transform (assert `ctx.scale(-1,1)` / translate called).
- `hudRenderer`: given a `PoseResult`, the expected chip draw calls happen (mock 2D ctx, assert
  `fillText` for reps/score, "Fix:" chip when `worst` set, cue caption present).

Manual QA checklist (add to PR description):
- [ ] Front cam: recording mirrors correctly, skeleton + chips visible, cue updates.
- [ ] Back cam (phone): un-mirrored, sharp at 720p.
- [ ] iOS Safari: produces `.mp4`, share sheet saves to Photos.
- [ ] Android Chrome: produces `.webm`, downloads/saves.
- [ ] Live overlay does not visibly stutter while recording (drop to 24fps if it does).
- [ ] Recorder auto-stops on Finish set and on tab switch.

---

## 9. Out of scope (do not build now)
- Server-side / cloud storage of clips, sharing links, accounts.
- Trimming/editing UI, audio capture (camera is `audio:false`).
- Recording the chat panel or anything outside the camera stage.

## 10. Commit (per `.claude/rules/code-style.md` git format)
```
[feat] feat: on-device session recording with overlay + HUD

- compositor canvas records video + pose overlay + native HUD chips
- codec feature-detect (webm/vp9 desktop, mp4/h264 iOS), local save via share/download
- record button + REC timer in stage; auto-stop on finish set / camera release
```
