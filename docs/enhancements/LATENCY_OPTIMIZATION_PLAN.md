# PoseCoach — Latency Optimization Plan (Phase 2: resolution ruled out → pipeline & infra)

> **Supersedes** the "resolution-first, ship 320" framing (and the earlier INT8-first framing
> before it). The 2026-07-15 resolution sweep tested every candidate size against the 0.97-OKS
> accuracy gate — **all failed**. Model input resolution is closed as a latency lever.
> **Type:** Performance / additive. No feature-behaviour change.
> **Context:** Vercel PWA → WebSocket → FastAPI on a CPU Hugging Face Space; edge target
> Android + iOS. `.pt` not deployable (no GPU on Space, no torch on phones) — ONNX stays.

---

## Project Leader — where we are

Two experiment rounds are complete. The data closed two doors:

| Lever | Result | Verdict |
|-------|--------|---------|
| INT8-640 (end-to-end graph) | collapsed — all scores 0.000 | dead (repairable variant ≈ −13–20% only) |
| 320 input | −74% latency, mean OKS 0.8552 vs 640 | **fails 0.97 gate** |
| 448 input | −33% latency, mean OKS 0.9081 | **fails** |
| 512 input | −15% latency, mean OKS 0.9284, p95 ≈ 640's | **fails** (and prize too small anyway) |

Sweep record: `data/eval/resolution_sweep_results.json` (150 in-domain images, conf 0.5,
OKS-vs-640 proxy; detection parity was NOT the blocker — 448/512 detected slightly *more*
than 640 — keypoint placement disagreement was).

### The key observation
The model itself is not obviously the bottleneck:

- 640 FP32 local CPU: **26.7 ms mean** · recorded Space baseline: **≈54.9 ms mean (p95 57.2)**.
- At 15 FPS the frame budget is 66 ms. Even the Space's 55 ms fits — **if only one frame is
  in flight**. Perceived "lag" that ramps up over a session is the signature of **frame
  queueing** (client keeps sending at fixed FPS while server + network can't keep pace, so
  the backlog — and the on-screen delay — grows), plus network RTT Vercel↔Space and
  Space CPU contention/cold starts.
- Conclusion: **attack the pipeline, not the weights.**

---

## Phase 2 workstreams (ranked)

> **Code audit 2026-07-15 (before building anything):** two of the planned fixes already
> exist in the frozen core.
> - **Backpressure is DONE:** `usePoseStream.ts` sends at most one frame in flight
>   (`inFlightRef`), caps capture at 15 FPS, tracks an RTT EMA, and adaptively drops JPEG
>   quality (>160 ms RTT) and resolution (>300 ms). Frames are *skipped*, never queued.
>   Workstream "drop-latest" is therefore closed — no backlog can build.
> - **Server instrumentation is DONE:** every WS reply already carries per-frame
>   `latency_ms` (inference time), and `posecoach_pipeline_stage_latency_seconds`
>   (Prometheus, by stage × exercise) plus P11 rolling per-stage logs cover the server side.
> - **Consequence:** with single-in-flight, perceived lag = per-frame round-trip. If deployed
>   RTT is ~300 ms, users see ~3 FPS overlay that trails by ~0.3 s — laggy but bounded. The
>   missing number is the **client-side breakdown of that RTT**: encode + network share vs.
>   the server's `latency_ms`. Nobody has read the deployed numbers end-to-end.

### 1. Latency diagnostics probe — *Frontend, additive, the only build needed now*
A dev-flagged Diagnostics panel (Settings tab) with its **own** WS connection to
`/ws/inference` — zero frozen-file edits (new files only + a mount point in the non-frozen
Settings component).
- Sends ~50 camera frames single-in-flight; records per frame: JPEG encode ms, RTT
  (send→reply), server `latency_ms` (from the reply), network+overhead = RTT − latency_ms.
- Reports p50/p95 per stage + effective FPS. Optionally POST-free — display only, user
  screenshots or copies JSON.
- Run it from a phone against `https://ashwintaibu-posecoach.hf.space` (P30 same-origin —
  browser talks to the Space directly).
- Cross-check server side via the token-gated `/metrics` (Prometheus histograms) from a
  machine with `METRICS_TOKEN`.
- **Gate:** a written p50/p95 breakdown from ≥1 real phone session. Maps to the thesis
  latency chapter (extends the <100 ms p95 metric with a deployed end-to-end table).
- **Decision rule:** network share dominates → on-device PoC is the fix (workstream 2);
  server `latency_ms` ≫ 55 ms benchmark → Space contention → tier upgrade (workstream 4);
  RTT ≈ benchmark and it still "feels" laggy → perception problem → interpolation/overlay
  smoothing discussion (the frozen `poseInterpolator` already exists).

> **PROBE RESULT 2026-07-15 (workstream 1 complete — `data/eval/latency_probe_desktop_2026-07-15.json`):**
> 50/50 frames vs prod Space, desktop Chrome. Per frame p50: encode **2.5 ms** ·
> server **58.5 ms** (p95 60.5 — dead stable, matches the 54.9 benchmark, no contention) ·
> network **210.4 ms** (p95 380.3) → RTT **269.1 ms**, effective **3.4 FPS**.
> **~80% of the round-trip is network. Decision rule fired: Space tier upgrade RULED OUT
> (would address ~58 ms of 269); on-device inference (workstream 2) selected as the fix.**
> Phone-on-mobile-data run still worth recording for the thesis table (expected worse network).

### 2. On-device inference PoC: onnxruntime-web — *Frontend + ML* ← **COMPLETE (built P32; gate met)**
Eliminates network + Space entirely; best fit for the Android/iOS edge target and the privacy
story (frames never leave the device — thesis-grade contribution).
- PoC: load `yolo_posecoach_v1.onnx` (12 MB) in the PWA via onnxruntime-web
  (WebGPU EP, wasm-simd fallback), measure per-frame ms on a real mid-range phone.
- Decision input, not a commitment: if a phone runs 640 in < 66 ms, this becomes the headline
  fix; if 150 ms+, it stays a thesis experiment.
- **Gate:** measured ms/frame on ≥ 2 real devices + keypoint parity vs. server output on the
  same frames.

> **PoC RESULT 2026-07-15 (workstream 2 complete — `data/eval/ondevice_poc_iphone_2026-07-15.json`,
> `ondevice_poc_desktop_2026-07-15.json`). Gate MET on both limbs.**
>
> | Path | per-frame p50 | p95 | FPS | parity vs server |
> |------|--------------|-----|-----|------------------|
> | Deployed WS round-trip (P31) | 269.1 ms | 438.6 | 3.4 | — (is the server) |
> | On-device **iPhone** (iOS 26.5.1, WebGPU) | **75 ms** (71 infer) | 80 | **13.2** | **1.3 px / 12 joints, conf 0.92** |
> | On-device desktop (Edge 150, WebGPU) | 31.7 ms (27.4 infer) | 41.3 | 30.4 | not obtained (framing) |
>
> **Accuracy: settled.** 1.3 px mean delta on a 384×512 frame (~0.3% of frame) validates the
> browser port end-to-end — BGR channel order, letterbox geometry, (300,57) one-to-one head
> decode, un-letterbox inverse. Residual is browser-vs-PIL JPEG decode + float precision. The
> port is faithful; **no accuracy argument against on-device remains.**
>
> **Speed: 3.6× better than deployed, but 14% over the strict budget.** 75 ms misses the 66 ms
> (15 FPS) line — so it satisfies neither branch of the original decision rule (<66 ms ⇒ headline
> fix; ≥150 ms ⇒ thesis-only). Judgement: **proceed.** The rule's thresholds were a proxy for
> perceived lag, and on that the verdict is not close — 13.2 FPS trailing 75 ms vs 3.4 FPS
> trailing 269 ms. WebGPU was selected on *both* devices (iOS included), and inference is
> remarkably stable (p50 71 / p95 76).
>
> **What this hands to workstream 3:** INT8-640 (head excluded, ≈ −13–20%) would take 75 → ~60–65 ms,
> landing under the 66 ms budget. It was "back pocket"; it is now **the natural closer**, and INT8
> helps most exactly where it is now needed (phone).
>
> **Unresolved risks (do not skip before committing to on-device as the product path):**
> - **Cold start ~41 s** (iPhone: 13.1 s model fetch + 28.4 s session create; desktop 57 s). The
>   fetch is one-time/cacheable; the session create — 24 MB wasm + WebGPU shader compile — recurs
>   per page load and browsers do not reliably persist compiled shaders. Not shippable as-is:
>   needs warming during the pre-workout screens and/or a smaller on-device model.
> - **Thermal throttling unmeasured.** The run is ~4.5 s of GPU load; a real set is minutes. Phone
>   GPUs throttle hard. A sustained (2–3 min) run is the next measurement, and it is the one that
>   could still overturn this.
> - **Android untested** (iOS only). WebGPU coverage there is patchier; the wasm-fallback path —
>   single-threaded by design, since COEP would break the exercise-image CDNs — is unmeasured.
> - `detected_frames` 14/50 (iPhone) / 31/50 (desktop) are **framing artifacts, not defects** —
>   iPhone samples 42–49 all detect and the parity frame right after scored 0.92.

### 3. Repair INT8-640 (head excluded) — *ML* ← **ACTIVE** (promoted by the P32 result)
Backbone/neck-only QDQ per-channel quantization, decode/TopK head excluded, MinMax calibration
(histogram OOMs locally). Expected ≈ −13–20%, accuracy-preserving. No longer optional: P32 landed
on-device at 75 ms vs a 66 ms budget, and this is the lever that closes that ~9 ms gap. Ships as
the **on-device** model (the Space keeps FP32-640) — so the accuracy gate is the vs-640 OKS proxy
at ≥0.97, and a regression here costs nothing server-side.

**Sequencing note:** the ~41 s cold start and the unmeasured thermal-throttling risk (see the P32
result box) are both bigger threats to on-device-as-product than the 9 ms. A sustained-load run is
cheap and could overturn the whole path — do it before or alongside this, not after.

### 4. Money lever: Space tier / keep-warm — *DevOps*
CPU upgrade or persistent hardware on the HF Space; eliminate cold starts. Zero code. Pairs
with whatever 1 finds about contention.

---

## Guardrails (unchanged)
Pose core FROZEN (`ws_inference.py`, `app/inference/**`, `app/analysis/**`, lifespan, frozen
frontend camera/pose hooks). Everything above is additive + env-flagged + one-flag revert +
Leader sign-off. YOLO26: no `end2end=False`, keypoints via `.xyn`, conf gate 0.5. No fabricated
numbers; gates don't loosen. Quality gate before any checkpoint: ruff / mypy --strict / pytest
cov ≥ 80 on `app/analysis`.

## Open items (separate)
- **Labeled `yolo_pose` val split** still not local (Drive or re-run P01) — blocks any formal
  OKS-mAP recheck vs 0.9126. All local accuracy work uses the vs-640 proxy meanwhile.
- **RGB/BGR finding:** local probe showed FP32 scores markedly higher with RGB input, but prod
  `OnnxPoseSession` feeds BGR. Possible latent accuracy bug in the frozen core — investigate
  and report before any change. (Independent of latency; do not bundle.)
- New artifacts kept for reference: `models/yolo_posecoach_v1_448.onnx`, `_512.onnx`
  (sweep exports; not wired anywhere).

## Leader's summary (updated 2026-07-15, after P32)
Resolution died as a latency lever (every size below 640 fails the accuracy gate). The code audit
then closed backpressure and server instrumentation — both already existed in the frozen core.
That left one unknown: where the deployed RTT actually goes. **P31 answered it — ~80% network,
server dead-stable at its benchmark — which killed the Space-tier lever and selected on-device.
P32 then measured on-device and the gate is met on both limbs: the browser port is provably
faithful (1.3 px vs the server), and an iPhone runs the full 640 graph at 75 ms/frame — 3.6×
better than the deployed 269 ms, 13.2 FPS vs 3.4.**

The 75 ms sits 14% over the 66 ms budget, so the original decision rule's two branches (<66 ⇒
headline fix, ≥150 ⇒ thesis-only) both miss it. Called as **proceed**: those thresholds were a
proxy for perceived lag, and on perceived lag it is not close.

**The remaining risk is no longer accuracy or per-frame speed — it is cold start (~41 s, of which
~28 s is per-page-load session create) and unmeasured thermal throttling over a real multi-minute
set.** Next: a sustained-load run (cheap; could overturn the path), Android, then workstream 3
(INT8 head-excluded) to close the last ~9 ms as the on-device model.

_History: the P31 probe shipped on `perf/latency-diagnostics` (#12); the P32 PoC on
`perf/p32-ondevice-poc` (#13) + build fix (#14). Both merged and deployed._
