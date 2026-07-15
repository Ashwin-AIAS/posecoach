# PoseCoach Latency Work — Session Handoff

Paste this into the new chat to carry context.

## The problem
Pose tracking feels laggy to users. Goal: cut inference latency without losing tracking
accuracy. Target is edge (Android/iOS); backend is FastAPI on a **CPU Hugging Face Space**,
frontend Vercel PWA. `.pt` is not deployable (no GPU on Space, no torch on phones) — ONNX stays.

## What we established (facts)
- **Production runs the 640 ONNX** — Space env var `MODEL_PATH = models/yolo_posecoach_v1.onnx`,
  description: "640 ONNX (FIX_POSE_TRACKING_QUALITY) — restores keypoint accuracy at mirror distance."
  i.e. 320 was already tried and **deliberately reverted to 640 for quality**.
- **Recorded baselines** (`data/eval/`): OKS-mAP@0.50 = **0.9126** (mAP@0.50:0.95 = 0.7638);
  640-ONNX CPU latency mean ≈ **54.9 ms** (p95 57.2).
- Model files present locally in `models/`: `yolo_posecoach_v1.pt`, `yolo_posecoach_v1.onnx` (640),
  `yolo_posecoach_v1_320.onnx` (320). **No labeled val split or datasets are local.**

## Experiments run (local, this session)
Script: `notebooks/quantize_int8_local.py` (INT8 + drift proxy) and `notebooks/resolution_sweep.py`.
- **INT8-640: FAILED** — quantizing the end-to-end graph (incl. score-decode/TopK head) collapsed
  the model (all detection scores = 0.000). Repairable only by excluding head nodes; even then ~13–20% faster.
  Also: histogram calibrators OOM locally (>15 GB) → had to use MinMax.
- **320: REJECTED** — 74% faster but mean OKS vs 640 = **0.8466** (need ≥0.97) and it drops ~11% more
  detections (110 vs 123/150). Confirms why prod moved 320→640.
- Local CPU latency (this machine, faster than the Space): 640≈25 ms, 320≈7 ms, INT8-640≈22 ms.

## Where we are (open experiment)
Running `notebooks/resolution_sweep.py`: exports **448 and 512** from the `.pt`, benchmarks
320/448/512/640, and scores each vs 640 (OKS + detection parity). Looking for the **smallest size
with mean OKS ≥ 0.97 and detection parity** = accuracy-preserving latency win.

## Decision fork (after the sweep)
- **If 448 or 512 passes** → ship it behind a new env flag `POSE_INPUT_SIZE=448|512|640` (default 640),
  as an additive, one-flag-revert change on branch `perf/low-latency-320` (rename as apt). Then confirm
  latency on the Space + formal OKS-mAP recheck.
- **If nothing below 640 passes** → resolution is a dead end; the delay is likely **not the model**.
  Attack latency at infra: warm/upgrade the Space, add drop-latest backpressure on the WS inference path,
  or move inference **on-device** (onnxruntime-web in the PWA — also best for the edge target + privacy).
  Optionally repair INT8-640 (head excluded) for a modest accuracy-preserving gain.

## Guardrails (project)
Pose core is FROZEN (`ws_inference.py`, `app/inference/**`, `app/analysis/**`, model lifespan).
Any model/size swap must be additive + behind an env flag + Leader sign-off. YOLO26: no `end2end=False`,
keypoints via `.xyn`, conf gate 0.5. Don't fabricate numbers; don't loosen accuracy gates.

## Open items (separate)
- **Recover the labeled `yolo_pose` val split** (Drive or re-run P01) — blocks the exact OKS-mAP recheck
  vs 0.9126. Local tests use an INT8/size-vs-640 keypoint-drift proxy instead.
- **RGB/BGR finding:** local probe showed FP32 scores markedly higher with RGB input, but production
  `OnnxPoseSession` feeds BGR. Possible latent accuracy bug — investigate separately (frozen-core).

## Deliverables created this session
- `docs/enhancements/LATENCY_OPTIMIZATION_PLAN.md` — the current strategy (resolution-first, INT8 deferred).
- `notebooks/quantize_int8_local.py`, `notebooks/resolution_sweep.py` — the experiments.
- (superseded) `notebooks/quantize_int8_colab.ipynb`, `RUN_QUANTIZE_AGENT_INSTRUCTIONS.md` — cloud path,
  abandoned once the model turned out to be local.

## Immediate next step
Run `python notebooks/resolution_sweep.py`, read the "--- recommendation ---" line, and follow the
decision fork above.
