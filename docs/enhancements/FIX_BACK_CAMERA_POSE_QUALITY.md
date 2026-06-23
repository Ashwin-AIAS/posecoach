# FIX — Back (Environment) Camera Produces Poor / No Pose Estimation

> Autonomous task brief for Claude Code. Self-contained. Work until **every**
> item in section 9 (Definition of Done) is checked. Do not stop at "looks fixed".
> Related prior work — read first so you do not regress it:
> `FIX_CAMERA_FLIP_LATENCY.md` (front↔back flip latency), `ONNX_DIRECT_INFERENCE_P15.md`
> (prod decode path), `RESPONSIVE_MOBILE_P19-P22.md` (camera stage layout).

---

## 1. Problem (observed)

The intended real-world setup: the user props the phone, stands in front of a
gym **mirror**, and uses the **back (environment) camera** because it is the
better sensor and gives a wider angle — the back camera "sees the mirror" and
estimates the pose from the reflection. This is the primary way a lifter would
actually use the app (you face the mirror, not the phone).

What happens instead: after tapping flip to the back camera, the wider field of
view appears **but the pose estimation gets noticeably worse or shows no usable
keypoints** — the skeleton drops out, the score ring stays empty, and the HUD
sits on "Hold still — adjusting to you" / "Position yourself in frame". The
front camera, by contrast, tracks fine.

## 2. Root cause (already diagnosed — verify, don't re-investigate from zero)

There is **no single bug**; the back camera exposes a chain of latent
distortions that the front camera happens to tolerate. Evidence, file by file:

### 2A. Double **non-aspect-preserving** resize → distorted geometry → low keypoint confidence  *(primary)*

1. **Frontend squish.** `frontend/src/hooks/usePoseStream.ts` captures every
   frame into a **fixed 4:3 canvas** regardless of the camera's true aspect:
   ```ts
   const NORMAL_PROFILE   = { width: 320, height: 240, quality: 0.65 }
   const DEGRADED_PROFILE = { width: 256, height: 192, quality: 0.5 }
   ...
   ctx.drawImage(video, 0, 0, profile.width, profile.height)  // stretches to 4:3
   ```
   The front camera (requested 640×480 → native ~4:3) maps to 320×240 with no
   distortion. A typical phone **back camera is 16:9** (e.g. 1280×720), so
   `drawImage` **horizontally squishes** the person before anything else happens.

2. **Backend square-stretch.** `app/inference/runner.py::_decode_frame` then
   force-resizes that JPEG to a **square**, with no letterboxing:
   ```python
   img = Image.open(BytesIO(raw)).convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
   ```
   `size` is 320 (PyTorch dev) or the ONNX graph's `imgsz`. So a 4:3 frame is
   stretched to 1:1 — a second distortion — for **both** cameras.

   Net effect: the model sees an anatomically-wrong (too-wide / squished) person.
   YOLO26-pose keypoint **confidence drops**, more so for the back camera because
   its distortion differs from what the model effectively saw during the
   front-camera-shaped eval pipeline. Standard YOLO preprocessing is
   **letterbox (aspect-preserving pad)**; we are stretching instead.

### 2B. Far / small subject in the mirror compounds 2A → joints fall below the confidence gate

A mirror roughly **doubles** the subject distance, so the body is small in the
frame. We then send it at only **320×240** (or 256×192 when RTT is high). Few
pixels on a small, distorted person → low per-keypoint confidence. Those joints
are then dropped:

- `app/analysis/keypoint_utils.py`: `ANGLE_CONF_THRESHOLD = 0.25` — any joint
  below this is excluded from `compute_angles` (returns `None`).
- `app/analysis/form_scorer.py` (~line 500): if **no** tracked joint clears the
  gate, it returns `status = STATUS_INSUFFICIENT_CONFIDENCE` with score 0 — which
  the HUD renders as "Hold still — adjusting to you" / no skeleton. **This is the
  exact symptom the user reports.**
- `app/inference/runner.py`: PyTorch path uses `conf=0.10` at inference; the
  square-stretch pushes many joints under even the downstream 0.25 angle gate.

### 2C. `getUserMedia` constraints are weak → back camera negotiates an arbitrary mode

`frontend/src/hooks/useCamera.ts` requests `video: { width, height, facingMode }`
with **plain** values (not `ideal`, no `aspectRatio`). The back camera is free to
hand back any native resolution/aspect, which feeds 2A. (Note: per
`FIX_CAMERA_FLIP_LATENCY.md` the back camera is intentionally **not** requested at
720p — keep it that way; see §6 warning.)

### 2D. Angles are computed in raw **normalized** space → aspect-dependent  *(accuracy/consistency)*

`compute_angles` builds joint-angle vectors directly from normalized `(x, y)` in
[0,1]. Because x and y are each normalized by the (square) image, a 16:9 source
and a 4:3 source yield **different angles for the same physical pose**. So even
when the back camera's joints clear the gate, the resulting form angles — and the
score — are skewed relative to the Fit3D-derived `ANGLE_RANGES`.

### 2E. `object-cover` display vs. full-frame inference → skeleton drifts off the body  *(alignment)*

The video is shown with `object-cover` (`frontend/src/components/CameraFeed.tsx`)
— it crops to the stage's aspect. But the model receives the **full** frame, and
`PoseOverlay` maps normalized coords straight onto the stage canvas
(`x*W, y*H`). When the video aspect ≠ stage aspect (always true for a 16:9 back
camera on a portrait stage), the skeleton is offset from the visible body near
the edges. Mirror framing (subject centered but small) makes this read as "the
dots don't sit on me."

**Mirroring itself is NOT the bug.** The mirror handling is already correct and
consistent across display, overlay and recorder (`camera.facingMode === "user"`
gates the `.mirror` CSS in `CameraFeed`, the `1 - x` flip in `PoseOverlay`, and
the recorder draw). Do not change the mirror wiring except for the optional UX
toggle in §5 Phase 5.

## 3. Goal

The back (environment) camera must give pose estimation **on par with the front
camera**, including the mirror-at-distance setup:

- Keypoint confidence on the back camera high enough that the skeleton renders
  and the score populates (no spurious `insufficient_confidence`).
- The skeleton sits on the body for both cameras.
- No regression to front-camera quality, to flip latency, or to the p95 latency
  thesis gate (< 100 ms).
- Every change maps to a thesis metric (§8) — this is a thesis project.

## 4. Design decision (read before coding)

The fix removes the distortion **end-to-end** and is **staged** so the
high-impact, low-risk parts land first:

- **Phase 1 + 2 (must-do)** remove the geometric distortion (backend letterbox +
  frontend aspect-correct capture). This is what actually resolves "no quality
  points". It **preserves the existing coordinate contract** (keypoints still
  come back normalized to the sent frame), so front-camera behaviour and
  `ANGLE_RANGES` calibration are unchanged.
- **Phase 3 (recommended)** fixes overlay drift (§2E).
- **Phase 4 (optional, gated)** makes angles aspect-invariant (§2D) — **changes
  angle values**, so it requires re-validating `ANGLE_RANGES`. Do NOT ship it
  without re-running the angle-MAE + consistency evals.
- **Phase 5 (optional)** is mirror-specific UX.

Keep `keypoints` normalized to **the original sent frame** at the WS boundary —
that is the contract `PoseOverlay`, `useSessionRecorder`, `usePoseTrail` and the
eval scripts already depend on. All coordinate math below honours that.

---

## 5. Implementation steps

### Phase 1 — Backend: letterbox instead of square-stretch, then un-letterbox the keypoints  *(must-do)*

File: `app/inference/runner.py`.

1. **Add a letterbox decode.** Replace the square `.resize((size, size))` in
   `_decode_frame` with an aspect-preserving resize padded to a square. Capture
   the transform so it can be inverted. Use YOLO's pad grey `114`.
   ```python
   @dataclass(frozen=True)
   class LetterboxMeta:
       size: int        # square side fed to the model
       scale: float     # min(size/w0, size/h0)
       pad_x: int       # left pad (px, in the square)
       pad_y: int       # top pad
       new_w: int       # resized content width  (w0*scale)
       new_h: int       # resized content height (h0*scale)
       src_w: int       # original sent-frame width  w0  (for Phase 4 aspect)
       src_h: int       # original sent-frame height h0

   def _decode_frame(frame_b64: str, size: int) -> tuple[npt.NDArray[np.uint8], LetterboxMeta]:
       raw = base64.b64decode(frame_b64)
       img = Image.open(BytesIO(raw)).convert("RGB")
       w0, h0 = img.size
       scale = min(size / w0, size / h0)
       new_w, new_h = max(1, round(w0 * scale)), max(1, round(h0 * scale))
       resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
       canvas = Image.new("RGB", (size, size), (114, 114, 114))
       pad_x, pad_y = (size - new_w) // 2, (size - new_h) // 2
       canvas.paste(resized, (pad_x, pad_y))
       meta = LetterboxMeta(size, scale, pad_x, pad_y, new_w, new_h, w0, h0)
       return np.array(canvas, dtype=np.uint8), meta
   ```

2. **Invert the letterbox on the returned keypoints** in `run_inference`, so the
   output is normalized to the **original sent frame** (true proportions, same
   space as today). `_predict` returns `kp_xyn` normalized to the **square**:
   ```python
   def _unletterbox_xyn(kp_xyn: npt.NDArray[Any], m: LetterboxMeta) -> npt.NDArray[Any]:
       # square-normalized -> square px -> remove pad -> normalize to original frame
       px = kp_xyn[:, 0] * m.size - m.pad_x
       py = kp_xyn[:, 1] * m.size - m.pad_y
       out = np.empty_like(kp_xyn)
       out[:, 0] = np.clip(px / m.new_w, 0.0, 1.0)
       out[:, 1] = np.clip(py / m.new_h, 0.0, 1.0)
       return out
   ```
   Thread `meta` out of `_decode_frame`, call `_unletterbox_xyn(kp_xyn, meta)`
   before constructing `InferenceOutcome`, and (Phase 4) add the source aspect to
   the outcome. This path runs for **both** the PyTorch and ONNX models because
   both flow through `_decode_frame` → `_predict` → `run_inference`. The ONNX
   `predict` already returns `kpts[:, :2] / imgsz` (square-normalized), so the
   same inverse applies unchanged.

3. **Why this is safe for the front camera.** A 4:3 frame stretched to a square
   today already returns coords that equal original-frame-normalized (stretching
   is linear and full-frame). Letterboxing returns the **same** normalized coords
   — only the *model input* changes (undistorted), which can only improve or
   match keypoint confidence. Re-run the consistency eval (§7) to confirm.

### Phase 2 — Frontend: capture aspect-correct frames (+ modest back-cam resolution)  *(must-do)*

File: `frontend/src/hooks/usePoseStream.ts`.

1. **Stop squishing.** Size the capture canvas to the **video's true aspect**
   instead of a hardcoded 4:3, capping the long side. Read
   `video.videoWidth/videoHeight`:
   ```ts
   const LONG_SIDE_NORMAL = 384   // was effectively 320 wide @ 4:3
   const LONG_SIDE_DEGRADED = 288 // RTT-high fallback
   ...
   const vw = video.videoWidth || 640
   const vh = video.videoHeight || 480
   const longSide = rttEmaRef.current > RTT_DEGRADE_MS ? LONG_SIDE_DEGRADED : LONG_SIDE_NORMAL
   const scale = longSide / Math.max(vw, vh)
   const cw = Math.round(vw * scale)
   const ch = Math.round(vh * scale)
   if (canvas.width !== cw) canvas.width = cw
   if (canvas.height !== ch) canvas.height = ch
   ctx.drawImage(video, 0, 0, cw, ch)   // aspect preserved — no squish
   ```
   Keep the existing `inFlight` backpressure, 15-FPS cap, and JPEG quality. The
   payload stays `{ frame, exercise }` / `{ frame, mode, pose }` — **no protocol
   change** (the backend derives aspect from the JPEG itself).

2. **Give the far/mirror subject more pixels.** A 384 long-side preserves ~44%
   more linear resolution than today's 320 — meaningful for a small mirrored
   subject — at a modest JPEG-size cost well under the 256 KB `MAX_FRAME_BYTES`
   backend cap. Validate the encoded size stays in budget; if p95 latency rises
   past the gate, drop `LONG_SIDE_NORMAL` to 352. Do **not** raise the
   `getUserMedia` resolution to gain pixels — see §6.

3. **(Optional) tighten constraints** in `useCamera.ts` for a cleaner native
   mode without touching the negotiated resolution tier:
   ```ts
   video: { width: { ideal: width }, height: { ideal: height },
            facingMode: { ideal: next }, aspectRatio: { ideal: 16 / 9 } }
   ```
   Keep the existing try/catch fallback (desktops with one camera must still
   work). Do not use `{ exact: 'environment' }` as the primary request — it
   throws on single-camera devices; the current graceful fallback is correct.

### Phase 3 — Frontend: make the overlay honour `object-cover`  *(recommended — fixes drift §2E)*

Files: `frontend/src/components/PoseOverlay.tsx`, `frontend/src/lib/poseRenderer.ts`
(the `screenX` helper), and mirror the same transform in
`frontend/src/hooks/useSessionRecorder.ts` so recordings match.

The browser draws the video object-cover with
`coverScale = max(W/vw, H/vh)` and centers it, cropping the overflow. Project
normalized keypoints through the **same** transform instead of `x*W, y*H`:
```ts
const coverScale = Math.max(W / vw, H / vh)
const dispW = vw * coverScale, dispH = vh * coverScale
const offX = (dispW - W) / 2, offY = (dispH - H) / 2
const sx = (mir ? (1 - nx) : nx) * dispW - offX
const sy = ny * dispH - offY
```
Pass `vw/vh` (the video's `videoWidth/videoHeight`) into `PoseOverlay`. This
fixes skeleton-on-body alignment for **both** cameras; it is independent of
Phases 1–2 and changes no backend behaviour.

### Phase 4 — Backend: aspect-invariant angles  *(optional — GATED on re-validation §7)*

File: `app/analysis/keypoint_utils.py`. Make `compute_angles` accept the source
aspect (from `LetterboxMeta.src_w/src_h`, plumbed through `InferenceOutcome` and
the WS handler) and scale x into square pixel space before the vector math so a
16:9 and a 4:3 capture of the same pose give the same angle:
```python
def compute_angles(kp, kp_conf, conf_threshold=ANGLE_CONF_THRESHOLD, aspect: float = 1.0):
    # aspect = src_w / src_h; multiply x by aspect to undo normalized squish
    kp = kp.copy(); kp[:, 0] *= aspect
```
**This shifts every angle, including the front camera's**, so it invalidates the
current `ANGLE_RANGES` calibration. Only ship it together with either (a) a
re-export of `ANGLE_RANGES` from the angle pipeline under the new convention, or
(b) confirmation from `eval_form_consistency.py` + the angle-MAE eval that the
gates still pass. If unsure, **leave Phase 4 out** — Phases 1–3 already fix the
reported problem.

### Phase 5 — UX for the mirror workflow  *(optional, nice-to-have)*

1. **Far-subject hint.** When a person is detected but the median torso width is
   small (subject far / in a mirror), surface a one-line coach hint
   ("Move closer or fill more of the mirror") via the existing
   `EmptyStageHint` / status-banner channel — not a new system. Maps to the
   user-study usability metric.
2. **Manual mirror toggle.** A mirror reflection is already laterally inverted,
   so some users want the back-camera preview un-inverted to match how they see
   themselves. Add a small toggle that forces the `.mirror` class / overlay flip
   independent of `facingMode`. Pose accuracy is unaffected (display-only).
3. **Document the left/right caveat.** A mirror swaps left↔right, so YOLO's
   "left wrist" is the user's right. Harmless for symmetric scoring; note it for
   unilateral scoring (`FIX_UNILATERAL_ARM_SCORING.md`) so a future change does
   not silently mislabel sides in the mirror setup.

---

## 6. Constraints & warnings (do not regress these)

- **Do NOT raise the back-camera `getUserMedia` resolution** to gain pixels.
  `FIX_CAMERA_FLIP_LATENCY.md` deliberately dropped it from 720p to 640×480
  because high sensor modes make flip slow on mobile. The quality gain here comes
  from **aspect-correct capture + backend letterbox**, not megapixels.
- **YOLO26 is NMS-free, dual-head.** Never pass `end2end=False`; never call NMS;
  keypoints via `results[0].keypoints.xyn`. Phase 1 touches only pre/post
  processing, not the predict call — keep it that way.
- **structlog only**, no `print()`. If you add timing/aspect logs use the
  existing `inference_complete` event fields.
- **p95 latency gate < 100 ms** must still hold — letterbox adds one small PIL
  paste; the 384 long-side adds a little encode/decode. Measure with
  `eval_latency.py` before declaring done.
- **OneDrive truncation:** when editing these files, write via the method that
  has worked in this repo (bash heredoc / verified writes), and confirm with
  `wc -l` + `python -c "import ast; ast.parse(open(f).read())"` for the Python
  files. Recover any truncation from `git show HEAD:<path>`.

## 7. Tests to add / update

Backend (`tests/`, SQLite in-memory, `respx`/synthetic fixtures — see
`.claude/rules/testing.md`):

- `tests/test_runner_letterbox.py` (new):
  - A non-square synthetic frame (e.g. 16:9) round-trips: feed a frame with a
    known keypoint, assert `_unletterbox_xyn` returns the original-frame
    normalized coords within tolerance.
  - Letterbox of a 1:1 frame is the identity (pad = 0).
  - A wide frame is **not** horizontally compressed (aspect of content == source
    aspect).
- Extend `tests/test_form_consistency.py`: the same pose captured at 4:3 vs 16:9
  produces scores within the **< 5% variance** gate (guards §2D regressions and,
  if Phase 4 ships, proves invariance).
- Re-run `scripts/eval_form_consistency.py` and the angle-MAE eval; confirm the
  thesis gates still pass (record before/after numbers in the PR).

Frontend (`vitest`):

- `usePoseStream` capture sizes the canvas to the video aspect (mock a
  `videoWidth/videoHeight` of 1280×720 → canvas ~384×216, not 320×240).
- Phase 3: a `PoseOverlay` projection unit test — a keypoint at nx=0 with a 16:9
  video on a portrait stage lands at the cover-cropped x, not 0.
- Existing `CameraFeed.mirror.test.tsx` must still pass unchanged.

## 8. Thesis-metric mapping (every change must earn its place)

| Change | Thesis metric | Script |
|--------|---------------|--------|
| Letterbox decode (P1) + aspect capture (P2) | Keypoint quality / OKS-mAP under webcam input; fewer `insufficient_confidence` frames | `eval_yolo.py`, ad-hoc confidence audit |
| No latency regression | Inference p95 < 100 ms | `eval_latency.py` |
| Aspect-invariant scoring (P2/P4) | Form-score consistency < 5% variance across cameras | `eval_form_consistency.py` |
| Overlay alignment (P3) + mirror UX (P5) | User-study SUS ≥ 70 (usability of the real mirror workflow) | `eval_user_study.py` |

Thesis framing: "PoseCoach supports a **mirror-based capture mode** (rear camera
→ mirror reflection). We letterbox to preserve subject proportions and project
keypoints through the display's object-cover transform, keeping form-score
consistency within 5% across front/rear cameras."

## 9. Definition of Done

- [ ] `_decode_frame` letterboxes (aspect-preserving + pad); `run_inference`
      returns keypoints un-letterboxed to the original sent frame, for both PT
      and ONNX paths.
- [ ] `usePoseStream` captures at the video's true aspect ratio (no 4:3 squish),
      long-side ≤ 384, within `MAX_FRAME_BYTES`.
- [ ] Back camera renders a stable skeleton + populated score for a subject at
      mirror distance where it previously showed `insufficient_confidence`
      (manual device test on the deployed HF Space; note the device + browser).
- [ ] Front-camera quality, flip latency, and p95 latency gate all unchanged
      (`eval_latency.py` re-run, numbers recorded).
- [ ] `eval_form_consistency.py` still passes (< 5% variance); 4:3-vs-16:9 test
      added and green.
- [ ] New/updated backend + frontend tests pass; `ruff check`, `mypy --strict`,
      and the coverage gate (`--cov-fail-under=80` on `app/analysis`) all pass.
- [ ] Phase 3 shipped OR an explicit note in the PR that overlay drift is
      accepted for now. Phase 4 shipped ONLY with `ANGLE_RANGES` re-validated.
- [ ] Mirror left/right caveat documented near the unilateral-scoring code.

## 10. Suggested commit sequence

1. `[FIX] feat: letterbox decode + un-letterbox keypoints (back-camera quality)`
2. `[FIX] feat: aspect-correct frame capture in usePoseStream`
3. `[FIX] fix: project pose overlay through object-cover transform`
4. `[FIX] test: 4:3 vs 16:9 consistency + letterbox round-trip`
5. *(optional)* `[FIX] feat: mirror-mode hint + manual mirror toggle`
6. *(optional, gated)* `[FIX] feat: aspect-invariant joint angles + ANGLE_RANGES re-validate`
