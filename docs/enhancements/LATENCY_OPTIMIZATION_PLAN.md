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

### 2. On-device inference PoC: onnxruntime-web — *Frontend + ML*
Eliminates network + Space entirely; best fit for the Android/iOS edge target and the privacy
story (frames never leave the device — thesis-grade contribution).
- PoC: load `yolo_posecoach_v1.onnx` (12 MB) in the PWA via onnxruntime-web
  (WebGPU EP, wasm-simd fallback), measure per-frame ms on a real mid-range phone.
- Decision input, not a commitment: if a phone runs 640 in < 66 ms, this becomes the headline
  fix; if 150 ms+, it stays a thesis experiment.
- **Gate:** measured ms/frame on ≥ 2 real devices + keypoint parity vs. server output on the
  same frames.

### 3. Optional stack-on: repair INT8-640 (head excluded) — *ML*
Backbone/neck-only QDQ per-channel quantization, decode/TopK head excluded, MinMax calibration
(histogram OOMs locally). Expected ≈ −13–20%, accuracy-preserving. Worth doing only after 1–2
land, or as the on-device model (INT8 helps most on phone CPUs).

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

## Leader's summary
Resolution is dead as a latency lever — every size below 640 fails the accuracy gate, and the
sizes that come closest barely buy any speed. The code audit then closed two more workstreams
before they started: client backpressure and server instrumentation already exist in the frozen
core. With single-in-flight sending, felt lag = per-frame round-trip — so the one unknown left
is **where the deployed RTT goes** (encode vs network vs server). **Next step: build the
additive Latency Diagnostics probe (workstream 1), run it from a real phone against the prod
Space, and let the p50/p95 breakdown pick between on-device inference, a Space upgrade, or
overlay smoothing.** INT8 repair stays in the back pocket. No commits made; the probe ships on
a fresh `perf/latency-diagnostics` branch once `feat/p30-same-origin-deploy` is merged or
stashed.
