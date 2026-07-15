# Latency: the lab–deployment gap

**Status:** investigation complete (2026-07-15/16). Maps to the Evaluation chapter (§5)
and the Discussion.
**One-line finding:** the system passes its < 100 ms latency gate in the lab (57.2 ms p95)
while the deployed system round-trips in **269 ms** — and the cause is not the model.
Instrumenting the deployed path showed **~80% of the round-trip is network**, which
falsified the two most obvious fixes and selected a third that was then measured on real
hardware: **on-device inference, 75 ms/frame on an iPhone, at 1.3 px keypoint parity with
the server.**

---

## 1. The question

The thesis gate is *inference latency p95 < 100 ms*. `scripts/eval_latency.py` returns
**57.2 ms p95** and the gate passes. But users testing the deployed PWA reported that pose
tracking *felt* laggy. Both statements were true at once, which is the interesting part:
**the gate measures the model; the user experiences the system.**

This is the gap the investigation closes. It is worth stating plainly in the thesis
because it is a generalisable result: a latency metric measured on the developer's
machine can pass comfortably while the deployed artefact is four times slower, for
reasons the metric is structurally incapable of seeing.

## 2. Method

Four rounds. The rule adopted after round 1 was: **do not optimise anything until the
deployed breakdown is measured.** Rounds 1–2 are, in retrospect, exactly the mistake that
rule prevents — they optimised the model before anyone had established the model was the
problem. They are reported here rather than buried, because their negative results are
what justify the rule.

Guardrail throughout: the pose core (`ws_inference.py`, `app/inference/**`,
`app/analysis/**`, the frozen frontend camera/pose hooks) was never modified. Every
diagnostic shipped as additive, dev-flagged code.

## 3. Round 1 — INT8 quantisation: falsified

Post-training static INT8 quantisation of the full 640 graph, MinMax calibration
(histogram calibrators OOM'd locally at > 15 GB).

**Result: the model collapsed — all detection scores 0.000.** Quantising the score-decode
/ TopK head destroys it. A repairable variant (backbone/neck only, head excluded) was
estimated from the local timings at only **≈ 13–20%** — mean 22.4 ms vs 25.6 ms FP32@640.

**Verdict:** dead as a headline fix. Retained as a possible *on-device* model (§7).
Artifact: `notebooks/quantize_int8_local.py`.

## 4. Round 2 — Input resolution: falsified

If the model is the bottleneck, the cheapest lever is a smaller input. 448 and 512 were
exported from the fine-tuned `.pt` and benchmarked against 320 and the production 640.

Accuracy proxy: mean **OKS vs the 640 output** on the same 150 in-domain images (conf 0.5),
plus detection parity. Gate: mean OKS ≥ 0.97 **and** detections ≥ 97% of 640's. (The
labelled `yolo_pose` val split is not local, so a formal OKS-mAP recheck against the 0.9126
baseline was not possible — a stated limitation, see §8.)

| Input | mean latency | p95 | detections /150 | mean OKS vs 640 | Verdict |
|-------|-------------|-----|-----------------|-----------------|---------|
| 320 | 8.96 ms | 10.52 | 117 | **0.8552** | fail |
| 448 | 17.82 ms | 26.22 | 126 | **0.9081** | fail |
| 512 | 22.56 ms | 30.54 | 126 | **0.9284** | fail |
| 640 (ref) | 26.68 ms | 29.66 | 121 | — | — |

**Result: every size below 640 fails the accuracy gate.** Two details matter:

1. **Detection parity was not the blocker** — 448 and 512 actually detected *more*
   subjects than 640 (126 vs 121). The failure is **keypoint placement disagreement**.
   A cruder metric (does it find a person?) would have passed 512 and shipped a
   regression.
2. **The prize shrinks as accuracy improves.** 512 — the only near-miss — is just ~15%
   faster on the mean, and its **p95 (30.54 ms) is statistically indistinguishable from
   640's (29.66 ms)**. Even had it passed, it would not have moved a 269 ms round-trip.

**Verdict:** resolution is closed as a latency lever. This also independently confirms the
earlier production decision to revert 320 → 640 for mirror-distance tracking quality.
Artifacts: `notebooks/resolution_sweep.py`, `data/eval/resolution_sweep_results.json`.

## 5. Round 3 — Instrumenting the deployed path (the turning point)

A code audit first closed two planned workstreams that already existed in the frozen core:
client **backpressure** (`usePoseStream.ts` sends at most one frame in flight, caps at
15 FPS, drops stale frames — so no queue can build) and server **instrumentation** (every
WS reply already carries per-frame `latency_ms`). With single-in-flight sending, perceived
lag *is* the per-frame round-trip. The one unmeasured quantity was where that round-trip
goes.

A dev-flagged diagnostics probe (own WebSocket, 50 frames single-in-flight, at the app's
real capture profile) was built and run from a browser against the production Space.

| Stage | p50 | p95 | mean |
|-------|-----|-----|------|
| JPEG encode (client) | 2.5 ms | 4.3 | 2.8 |
| **Server** (`latency_ms`, decode+inference) | **58.5 ms** | 60.5 | 58.6 |
| **Network + overhead** (RTT − server) | **210.4 ms** | 380.3 | 228.0 |
| **Round-trip** | **269.1 ms** | 438.6 | 286.6 |

Effective rate: **3.4 FPS**. 50/50 frames scored.

**Result: ~80% of the round-trip is network.** Two conclusions fell straight out:

- **The server is not the problem.** 58.5 ms p50 with a p95 of 60.5 ms — dead stable, and
  sitting exactly at its own ≈ 54.9 ms benchmark. There is no contention and no cold-start
  tail. **A Space tier upgrade was therefore ruled out**: it targets 58 ms of a 269 ms
  problem, and buying more CPU would have been a plausible-sounding, measurable waste of
  money.
- **The lab metric was never wrong — it was answering a different question.** 57.2 ms lab
  vs 58.5 ms deployed is excellent agreement. The model was always fast. The 211 ms nobody
  had measured was the entire user-visible problem.

Artifact: `data/eval/latency_probe_desktop_2026-07-15.json`.

## 6. Round 4 — On-device inference: measured, and it works

If the network is the cost, remove the network. The production 640 ONNX is served to the
browser (`GET /api/v1/model/pose.onnx` streams the exact file the Space itself loads, so
the PoC can never test stale weights) and executed via onnxruntime-web — WebGPU EP with a
single-threaded wasm fallback.

Preprocessing reproduces the server bit-for-bit: letterbox to 640 with gray-114 padding,
/255, CHW float32, **in BGR channel order** (the server flips RGB→BGR before the graph, as
the fine-tune consumed Ultralytics' BGR path), decoded straight off the `(1, 300, 57)`
one-to-one head — argmax, 0.10 person gate, **no NMS**.

Correctness was not assumed. One frame, encoded once, is run through *both* pipelines —
locally and over a fresh WebSocket to the server (first frame on a fresh connection, so the
server's EMA smoother is identity and both sides expose raw model output).

| Path | per-frame p50 | p95 | FPS | keypoint parity vs server |
|------|--------------|-----|-----|---------------------------|
| Deployed WS round-trip (round 3) | 269.1 ms | 438.6 | 3.4 | — (is the server) |
| **On-device, iPhone** (iOS 26.5.1, WebGPU) | **75 ms** (71 infer) | 80 | **13.2** | **1.3 px / 12 joints, conf 0.92** |
| On-device, desktop (Edge 150, WebGPU) | 31.7 ms (27.4 infer) | 41.3 | 30.4 | not obtained (framing) |

**Accuracy: settled.** **1.3 px mean deviation** on a 384×512 frame — ~0.3% of the frame —
across the 12 joints clearing the 0.5 confidence gate on both sides, with the local model
scoring 0.92 confidence. That single number validates the whole port: channel order,
letterbox geometry, head decode, and the un-letterbox inverse. The residual is browser-vs-PIL
JPEG decode plus float precision. **No accuracy argument against on-device remains.**

**Speed: 3.6× better than deployed, 14% over the ideal.** 75 ms misses the 66 ms (15 FPS)
frame budget. The pre-registered decision rule — *< 66 ms ⇒ headline fix; ≥ 150 ms ⇒ thesis
experiment only* — **fired on neither branch**, and this is reported as a judgement rather
than dressed up as a threshold pass. The judgement is *proceed*: those thresholds were
proxies for perceived lag, and on perceived lag the comparison is not close — **13.2 FPS
trailing 75 ms against 3.4 FPS trailing 269 ms**, i.e. near the app's own 15 FPS cap versus a
slideshow. WebGPU was selected on both devices, iOS included, and inference is remarkably
stable (p50 71 / p95 76).

Artifacts: `data/eval/ondevice_poc_iphone_2026-07-15.json` (decisive),
`ondevice_poc_desktop_2026-07-15.json` (reference; its parity frame caught no person, so it
is marked non-gate).

## 7. What is *not* established

Reported here rather than in a footnote, because these are what stand between the PoC and a
product claim — and both outrank the 9 ms:

- **Cold start ≈ 41 s** (iPhone: 13.1 s model fetch + **28.4 s session create**; desktop
  57 s). The fetch is one-time and cacheable. The session create — 24 MB wasm plus WebGPU
  shader compilation — **recurs per page load**, and browsers do not reliably persist
  compiled shaders. Not shippable as-is: needs warming during the pre-workout screens
  and/or a smaller on-device model.
- **Thermal throttling: unmeasured.** The run is ~4.5 s of GPU load; a real set is minutes,
  and phone GPUs throttle hard. This is the single measurement that could still overturn
  the conclusion in §6, and it is cheap to obtain.
- **Android: untested.** WebGPU coverage is patchier; the wasm fallback is single-threaded
  **by design** (cross-origin isolation would break the exercise-image CDNs the workout
  logger depends on), and that path is unmeasured.
- **`detected_frames` (14/50 iPhone, 31/50 desktop) are framing artifacts, not defects** —
  iPhone samples 42–49 all detect, and the parity frame taken immediately after scored 0.92.
  The subject was walking into frame during the run.
- **Formal OKS-mAP recheck** against the 0.9126 baseline was not possible: the labelled
  `yolo_pose` val split is not available locally (Drive-only). All round-2 accuracy work
  uses the vs-640 proxy.
- **Single network sample.** Round 3 is one desktop session on one connection. A phone on
  mobile data would likely be worse, strengthening the conclusion rather than weakening it,
  but it is not measured.

**Next lever if pursued:** INT8-640 with the head excluded (§3) is now the natural closer —
≈ −13–20% takes 75 ms → ~60–65 ms, under budget — and it would ship as the *on-device*
model while the Space keeps FP32-640, so its accuracy gate is the vs-640 proxy and a
regression costs nothing server-side.

## 8. Why this belongs in the thesis

The headline metric was never in danger: mAP 0.9126, form-score CV 3.35%, latency 57.2 ms
p95 — all pass. The contribution here is the honesty about what those numbers *do not* say.

1. **A lab metric can pass while the deployed system fails the user.** 57.2 ms and 269 ms
   are both true measurements of the same system. Reporting only the first would be
   defensible and misleading.
2. **Falsification, done deliberately.** Three plausible fixes were killed with data, not
   opinion: INT8 (collapsed), resolution (0.8552 / 0.9081 / 0.9284 against a 0.97 gate),
   and a paid CPU upgrade (would have addressed 58 ms of 269). The negative results are the
   result — and the resolution sweep is a clean example of a *finer* metric preventing a
   regression a cruder one would have shipped.
3. **Measure before optimising.** Rounds 1–2 optimised the model for two sessions before
   anyone had established the model was the problem. One 50-frame probe then answered the
   question outright and redirected the entire effort. That is the methodological lesson,
   and it is worth stating as one.
4. **The proposed fix was validated, not asserted.** 1.3 px parity against the server on
   the same frame is what separates "we could run it in the browser" from "we ran it in the
   browser and it computes the same thing."

**Suggested framing:** *"We show that PoseCoach's < 100 ms inference gate, met in the lab
at 57.2 ms p95, does not describe the deployed system, which round-trips in 269 ms. By
instrumenting the deployed path we attribute ~80% of that to network transport rather than
computation, falsifying both model-side optimisation (INT8; input resolution, where every
size below 640 fails a 0.97-OKS gate) and infrastructure scaling. We then demonstrate
on-device inference via WebGPU as the structural fix, achieving 75 ms/frame on a
consumer smartphone at 1.3 px keypoint parity with the server implementation."*

This also strengthens the privacy chapter: on-device inference means frames never leave the
device at all — the strongest possible form of the guarantee the system already makes.

---

## Appendix — provenance

| Claim | Artifact | Reproduce with |
|-------|----------|----------------|
| mAP 0.9126 | `data/eval/yolo_results.json` | `scripts/eval_yolo.py` |
| Latency 57.2 ms p95 (lab) | `data/eval/latency_results.json` | `scripts/eval_latency.py` |
| Form CV 3.35% | `data/eval/consistency_results.json` | `scripts/eval_form_consistency.py` |
| INT8 collapse | — (documented) | `notebooks/quantize_int8_local.py` |
| Resolution sweep | `data/eval/resolution_sweep_results.json` | `notebooks/resolution_sweep.py` |
| Deployed RTT breakdown | `data/eval/latency_probe_desktop_2026-07-15.json` | `?diag=1` → Settings → Developer — Latency |
| On-device + parity | `data/eval/ondevice_poc_iphone_2026-07-15.json` | `?diag=1` → Settings → Developer — On-device |

Plan of record: `docs/enhancements/LATENCY_OPTIMIZATION_PLAN.md`.
Diagnostics code: `frontend/src/hooks/useLatencyProbe.ts`,
`frontend/src/hooks/useOnDeviceInference.ts` (both dev-flagged, additive; PRs #12–#15).
