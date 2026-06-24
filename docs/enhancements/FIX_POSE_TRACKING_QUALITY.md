# FIX — Pose Tracking Quality (steadiness, latency, mirror distance, posing match)

> Autonomous task brief for Claude Code. Self-contained. Work until **every**
> item in section 10 (Definition of Done) is checked. Do not stop at "looks fixed".
> This brief **supersedes and absorbs** `FIX_BACK_CAMERA_POSE_QUALITY.md` (whose
> Phases 1–3 already shipped in commit `6e5283e` — see §2). Read that file and
> `ONNX_DIRECT_INFERENCE_P15.md` first.

---

## 1. Problem (observed in a recorded device test — `mirror workflow`)

User props the phone and poses in front of a full-length mirror (bodybuilding
poses — front double biceps, etc.). Recorded evidence shows, **after the recent
updates**, tracking is *worse* than before:

- **Drops out / not steady.** The skeleton repeatedly vanishes and the HUD shows
  **"Step into frame"** with an empty score ring, then re-appears — flickering
  rather than tracking continuously.
- **Fails at mirror distance.** When the user stands back far enough to fit their
  whole body in the mirror (the natural posing distance), there is often **no
  skeleton at all**. It only locks on when they step close to the mirror.
- **Skeleton doesn't sit on the body / doesn't match the pose.** When tracked,
  joints look approximate and lag the real limbs — raising the arms into a biceps
  pose, the forearm/wrist keypoints don't follow crisply. The head keypoint
  floats off the head.
- **Back camera is worst** (wider FOV → subject even smaller → nothing).
- **Low light makes all of the above worse** — in a dim room the skeleton
  collapses into a jumble or disappears.

User's stated #1 goal: **rock-solid, low-latency pose tracking that stays glued
to the body through a posing routine**, at mirror distance, on the rear camera.

## 2. What already shipped (do NOT redo — verify, then build on it)

Commit `6e5283e` ("letterbox decode + aspect-correct capture + overlay
cover-projection") implemented Phases 1–3 of the prior brief and is **correct**:

- `app/inference/runner.py::_decode_frame` letterboxes (aspect-preserving pad)
  and `run_inference` un-letterboxes keypoints back to the sent frame.
- `frontend/src/hooks/usePoseStream.ts` captures at the video's true aspect
  (`LONG_SIDE_NORMAL = 384`, no 4:3 squish).
- `frontend/src/lib/poseRenderer.ts::computeCoverProjection` + `PoseOverlay`
  project keypoints through the `object-cover` transform. **This helper already
  guards `videoWidth <= 0`** and is sound — the residual "skeleton off the body"
  in the video is **keypoint imprecision, not a projection bug** (see §3).

Keep all of the above. The remaining problem is upstream of it.

## 3. Root cause (diagnosed — verify, don't re-investigate from zero)

### 3A. The deployed model is the **320×320** ONNX — this is the core regression  *(primary)*

`.env`: `MODEL_PATH=models/yolo_posecoach_v1_320.onnx`. Inspected input shapes:

| File | Input | Notes |
|------|-------|-------|
| `models/yolo_posecoach_v1.onnx`     | `[1,3,640,640]` | the README "production" model — mAP@0.5 0.913, p95 **57.2 ms** |
| `models/yolo_posecoach_v1_320.onnx` | `[1,3,320,320]` | **currently deployed**, from commit `7d46970` (P15, "imgsz=320" for latency) |

320² is **¼ the pixels** of 640². The P15 switch to 320 traded a large amount of
keypoint accuracy and small-subject detection for ~30 ms of latency that the
budget did not need (gate is p95 < 100 ms; the 640 model measured 57.2 ms). A
distant mirror subject is only ~80–120 px tall inside a 320 input — at or below
YOLO26n's reliable detection floor → **"Step into frame"** and jittery joints.

### 3B. Letterbox (3-correct) **starves** a portrait/distant subject *at imgsz 320*  *(interaction)*

The letterbox fix is right, but it makes the 320 model's weakness worse for the
mirror case. A portrait capture (e.g. 288×384) letterboxed into 320² leaves the
subject in only a **240×320** region (side padding) instead of filling the square
like the old stretch did. Fewer subject pixels at an already-too-small input →
more dropouts. **The letterbox is not the bug; the 320 input is.** At 640 the same
subject gets ~480×640 px — ample. So 3A and 3B share one fix: **raise the model
input size.**

### 3C. No persistence → single missed frame blanks the skeleton  *(steadiness)*

`PoseOverlay` returns early and draws nothing whenever a frame has no person /
wrong keypoint count, and calls `interp.reset()`. So one dropped/again-detected
frame makes the whole skeleton flash off and on. That is the "not steady"
flicker, independent of accuracy.

### 3D. Adaptive profile collapses on the **deployed** backend  *(latency/lag)*

`usePoseStream` degrades to `LONG_SIDE_DEGRADED = 288` whenever smoothed
`RTT > RTT_DEGRADE_MS (80 ms)`. On the live free-tier server (network + 2-vCPU
inference) RTT is routinely > 80 ms, so the app **sits permanently in the
low-detail profile** and the single-in-flight backpressure throttles effective
FPS — laggy and low-res. Locally (sub-80 ms RTT) it stayed crisp, which is why it
"used to feel better."

### 3E. Low light  *(contributing)*

Dim room → noisy, low-confidence keypoints → joints fall under the gates
(`ANGLE_CONF_THRESHOLD=0.25`; display gate 0.5) → dropouts/jumble. Compounds 3A.

## 4. Goal

Restore (and exceed) the earlier tracking feel for the real mirror workflow:

- Skeleton **locks on at mirror distance** on both cameras (no spurious "Step into
  frame" when the whole body is visible).
- Joints **stay glued to the body** and follow arm/hand posing with minimal lag.
- **Steady** — no per-frame flicker; brief detection gaps are bridged, not blanked.
- Latency p95 stays **< 100 ms** on the deploy target (quality first, then claw
  back latency via FPS/threading — never by returning to the 320 model).
- Every change maps to a thesis metric (§9).

## 5. Implementation steps

### Phase 1 — Restore inference resolution  *(core fix; do first)*

> **✅ Status (2026-06-24): Option A selected and validated.** The Phase 1.4 hard
> gate PASSED on the 640 direct-ONNX model (`models/yolo_posecoach_v1.onnx`): 16
> consecutive real device-clip frames → 16/16 detected, 17 finite keypoints each,
> output tracks input, the `(1,300,57)` output decodes cleanly (no shape
> mismatch), predict 52–79 ms. **Implement Option A.** PT@640 is now only the
> local/GPU reference. Local end-to-end touched 123 ms, so still measure the
> deploy p95 (§Phase 1.2) — a 512 export is a likely fallback on the free CPU tier.

> **⚠ Model-path history — read before touching `MODEL_PATH` (the user fought this for weeks).**
> "ONNX = no body keypoints" was real, but it was **one specific path**: the
> **Ultralytics ONNX predictor** (`YOLO(model.onnx).predict()`). In ultralytics
> 8.4.x it resets `predictor.args.task` to `detect` on the 2nd+ call, so
> `results[0].keypoints` becomes `None` and the InferenceSession enters a bad
> state — commits `f283c84`, `9f29236`, `205fe47`. They abandoned it for PT.
> The **current** ONNX path is **different**: `app/inference/onnx_session.py::OnnxPoseSession`
> is a **direct onnxruntime** session with its own keypoint decode (commit
> `7d46970`) — it never invokes the Ultralytics predictor, is **immune to that
> bug**, and the recorded video proves it **does** produce keypoints (just low-res
> at 320). Raising resolution is safe **on this direct path**. Do **NOT**
> reintroduce `YOLO(*.onnx)`.

1. **Pick a higher-res model on a path that produces keypoints — then validate
   before shipping (§Phase 1.4).** Two safe options; choose by measured latency
   on the deploy target:
   - **(A) Direct ONNX @ 640 — preferred for the live deploy (fast).** Set
     `MODEL_PATH=models/yolo_posecoach_v1.onnx` (the existing `[1,3,640,640]`
     model) so it loads via `OnnxPoseSession`, NOT the Ultralytics predictor.
     ONNX is ~10× faster than PT on CPU (their own note, `f283c84`).
   - **(B) PT @ 640 — the path the user trusts (correctness fallback).** Set
     `MODEL_PATH=models/yolo_posecoach_v1.pt` and raise `_PT_INFERENCE_SIZE`
     320 → 640 in `app/inference/runner.py`. Reliable keypoints, but PT-on-CPU is
     much slower — realistic only for local / GPU (Modal), likely over the 100 ms
     gate on the free CPU tier.
   Update the stale "imgsz=320" comments in `runner.py` / `onnx_session.py`, and
   set `MODEL_PATH` in the **deploy** env (HF Space / Render), not just repo `.env`.
2. **Measure on the actual deploy target**, not just locally:
   `python scripts/eval_latency.py` (and watch the live `inference_complete`
   logs). Decision tree on p95:
   - **≤ 100 ms →** ship 640. Done.
   - **100–140 ms →** export a **512²** model from `yolo_posecoach_v1.pt`
     (`model.fuse()` then `model.export(format='onnx', imgsz=512, simplify=True,
     opset=17, dynamic=False)` — per `.claude/rules/yolo26.md`), deploy that.
   - **> 140 ms →** keep 512 but also raise ONNX threads
     (`intra_op_threads` to the Space's vCPU count) and/or move inference to the
     Modal GPU path (see `CLAUDE.md` deploy stack). Do **not** fall back to 320.
3. **Never pass `end2end=False`; YOLO26 stays NMS-free** (`.claude/rules/yolo26.md`).
   This phase changes only the model file + `imgsz`, not the predict call.
4. **Validate keypoints BEFORE shipping (hard gate — honors the ONNX history).**
   Push several real mirror-distance frames (extract from the recorded clip)
   through the chosen model and assert it returns a non-empty, sane 17-keypoint
   set across **consecutive** frames — not `None`, not frozen, not collapsed to a
   point. The old Ultralytics-ONNX bug only showed up on the 2nd+ call, so test a
   short sequence, not one frame. If the direct-ONNX-640 decode mis-parses the
   output tensor (different shape than the 320 export), fix `OnnxPoseSession`'s
   decode or fall back to option (B). **Never deploy a model that yields empty
   keypoints.**

   **✅ PASSED 2026-06-24** on the 640 ONNX (details in the Status note above). The
   check script is in the scratchpad as `validate_consecutive_frames.py` — promote
   it into the repo (see §8). One process note: an initial run threw a
   false-positive "frozen" verdict from a too-strict identical-output rule; it now
   compares input-vs-output motion, since byte-identical duplicate input frames
   *should* yield identical output for a deterministic model.

### Phase 2 — Feed the model enough detail  *(capture side)*

In `frontend/src/hooks/usePoseStream.ts`:

1. Raise `LONG_SIDE_NORMAL` to **512** (was 384) and `LONG_SIDE_DEGRADED` to
   **384** (was 288) so the JPEG actually carries detail for a 512/640 model and a
   small mirror subject. Keep quality ~0.6.
2. The encoded frame may now exceed the backend cap. Raise
   `MAX_FRAME_BYTES` in `app/api/v1/ws_inference.py` from `256*1024` to
   `512*1024` (still bounds a single payload; the 15-FPS + single-in-flight guards
   keep total pressure low). Confirm encoded size stays under it at 512 long-side.

### Phase 3 — Steadiness: bridge brief gaps instead of blanking  *(fixes 3C flicker)*

In `frontend/src/components/PoseOverlay.tsx`:

1. Add a **hold-last-pose hysteresis**: when a frame has no person, keep drawing
   the last good projected pose for up to **~400 ms**, fading opacity to 0 over
   that window, before clearing. Only `interp.reset()` after the hold expires.
2. Keep the existing interpolator, but make sure the hold and the interpolator
   don't fight (hold uses the last sampled pose). Add a small unit test that a
   single empty frame between two good frames does **not** blank the overlay.

### Phase 4 — Deploy-aware adaptive profile  *(fixes 3D lag)*

In `frontend/src/hooks/usePoseStream.ts`:

1. Raise `RTT_DEGRADE_MS` to **~160 ms** (the live server's healthy RTT is above
   80) so a normal deployed round-trip does **not** force the degraded profile.
2. Decouple **resolution** from **frame pacing**: under sustained high RTT, prefer
   lowering FPS (already self-throttled by single-in-flight) over dropping
   resolution, since the user wants accurate tracking more than max FPS. Only drop
   to `LONG_SIDE_DEGRADED` when RTT is genuinely pathological (e.g. > 300 ms).
3. Log the chosen profile + smoothed RTT (structlog on the backend already times
   stages; add a lightweight client console gauge or reuse the existing timing).

### Phase 5 — Mirror distance + low light UX  *(3E + usability)*

1. **Far-subject hint.** When a person is detected but median torso width is small
   (subject far / deep in the mirror), surface "Move closer or fill more of the
   mirror" through the existing `EmptyStageHint` / status-banner channel — not a
   new system. The video shows the user standing too far for a 320 model; even at
   640 a gentle nudge helps.
2. **Optional capture brightness assist.** In the capture canvas, allow a mild
   `ctx.filter = "brightness(1.15) contrast(1.08)"` before `drawImage` when the
   frame is dark (cheap mean-luma check). Gate behind a flag; verify it helps and
   doesn't wash out — keep off by default if marginal.
3. **Back camera** now benefits from Phases 1–2 automatically (bigger input +
   detail). Re-test the rear camera at mirror distance as a DoD item.

### Phase 6 — Lock in the projection correctness  *(regression guard)*

`computeCoverProjection` is correct; add a portrait-camera regression test
(`poseRenderer.coverProjection.test.ts`): a 9:16 video on a portrait stage keeps a
mid-body keypoint within a few px of the body, and `videoWidth === 0` falls back
to identity (no NaN/offset). This protects against a future re-break.

## 6. Regression bisect (if a phase doesn't explain the whole gap)

Two commits define the regression window — review their diffs before assuming
anything new:
- `7d46970` "[P15] direct ONNX inference (imgsz=320)" → the resolution drop (3A).
- `6e5283e` "[FIX] letterbox + cover-projection" → correct, but exposes 3B at 320.

Quickest empirical check: with the frontend unchanged, flip `MODEL_PATH` between
the 320 and 640 ONNX and compare live detection at mirror distance. Expect the 640
model to lock on where the 320 says "Step into frame". That single A/B confirms §3.

## 7. Constraints & warnings (do not regress these)

- **Quality over latency, but keep the gate.** p95 < 100 ms must still hold on the
  deploy target; if 640 can't, step to 512 — never back to 320.
- **Do NOT raise `getUserMedia` resolution** to gain pixels — keeps the
  `FIX_CAMERA_FLIP_LATENCY.md` flip-latency win. Detail comes from the capture
  long-side + model imgsz, not the sensor mode.
- **YOLO26 NMS-free**, never `end2end=False`, keypoints via `.xyn`, model loaded
  once in lifespan, inference in the executor (`.claude/rules/yolo26.md`).
- **structlog only**, no `print()`. **ONNX export:** `model.fuse()` before
  `model.export()`.
- **OneDrive truncation:** edit repo files via verified heredoc / safe writes;
  confirm Python files with `python -c "import ast; ast.parse(open(f).read())"`
  and `wc -l`; recover any truncation from `git show HEAD:<path>`.

## 8. Tests to add / update

- `tests/test_runner_letterbox.py`: extend to assert the un-letterbox round-trip
  holds at **imgsz 640** (not just 320).
- `frontend` `PoseOverlay`: hold-last-pose test (single empty frame doesn't blank;
  pose clears after the hold window).
- `frontend` `usePoseStream.aspect.test.ts`: update for the new `LONG_SIDE_*`
  values and assert encoded size stays under `MAX_FRAME_BYTES`.
- `poseRenderer.coverProjection.test.ts`: portrait-video regression (§Phase 6).
- **Promote the keypoint-health gate** — add `scripts/validate_consecutive_frames.py`
  (ad-hoc run over a real clip) **and** fold an equivalent into
  `tests/test_runner_letterbox.py` (a few committed frames) so the
  2nd-through-Nth-call gate runs in CI, not just by hand.
- Re-run `scripts/eval_latency.py` and `scripts/eval_form_consistency.py`; record
  before/after p95 and variance in the PR. Confirm thesis gates still pass.

## 9. Thesis-metric mapping

| Change | Thesis metric | Script |
|--------|---------------|--------|
| 640/512 model (P1) + capture detail (P2) | Keypoint quality / OKS-mAP under webcam; fewer no-person frames at distance | `eval_yolo.py`, live confidence audit |
| Resolution choice vs. budget | Inference p95 < 100 ms | `eval_latency.py` |
| Hold-last-pose (P3) + adaptive profile (P4) | Perceived tracking continuity; form-score availability | `eval_form_consistency.py`, qualitative |
| Mirror/low-light UX (P5) | User-study SUS ≥ 70 for the mirror workflow | `eval_user_study.py` |

Thesis framing: "Tracking quality at posing distance is input-resolution bound;
we run a 640² letterboxed input with gap-bridging temporal persistence, keeping
form-score consistency < 5% across cameras while holding p95 < 100 ms."

## 10. Definition of Done

- [ ] App + deploy run a ≥ 512² model; `eval_latency.py` p95 < 100 ms recorded
      (state which imgsz shipped and the measured p95).
- [ ] At mirror distance with the whole body in frame, the skeleton locks on (no
      spurious "Step into frame") on **both** front and rear cameras — manual
      device test, note device + browser + lighting.
- [ ] Skeleton stays on the body and follows an arms-up posing sequence without
      per-frame flicker (hold-last-pose verified).
- [ ] Deployed app no longer pinned to the degraded capture profile (log shows the
      normal profile at typical server RTT).
- [ ] `eval_form_consistency.py` still passes (< 5% variance); new/updated tests
      green; `ruff check`, `mypy --strict`, coverage gate (`--cov-fail-under=80`
      on `app/analysis`) all pass.
- [ ] Far-subject hint appears when the subject is small; low-light assist
      shipped or explicitly deferred with a one-line note in the PR.

## 11. Suggested commit sequence

1. `[FIX] feat: run 640 ONNX inference (restore tracking accuracy at distance)`
2. `[FIX] feat: raise capture long-side + frame-size cap to feed the model`
3. `[FIX] feat: hold-last-pose hysteresis (steady skeleton through gaps)`
4. `[FIX] fix: deploy-aware adaptive profile (stop pinning to degraded res)`
5. `[FIX] feat: mirror far-subject hint + optional low-light capture assist`
6. `[FIX] test: 640 letterbox round-trip + portrait projection + hold-pose`
