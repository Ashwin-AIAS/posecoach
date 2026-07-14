# PoseCoach — Latency Optimization Plan (Resolution-first; INT8 deferred)

> **Supersedes** the earlier INT8-first framing. Empirical benchmarking showed the
> input-resolution lever (320) beats INT8 quantization decisively, so the strategy is now
> **ship the 320 model**, with INT8 kept as an optional later add-on.
> **Type:** Performance / additive. No feature-behaviour change.
> **Context:** Vercel PWA → WebSocket → FastAPI on a CPU Hugging Face Space; edge target
> Android + iOS. PyTorch/`.pt` is not deployable (no GPU on Space, no torch on phones) — ONNX stays.

---

## Project Leader — framing

The kids feel lag because inference runs FP32 at 640 on a CPU Space. We keep ONNX and reduce
compute. We tested two levers locally against the fine-tuned model. The data decided it.

### What the local benchmark showed
| Model | Latency (local CPU, mean) | vs 640 FP32 | State |
|-------|---------------------------|-------------|-------|
| 640 FP32 (`yolo_posecoach_v1.onnx`) | 25.3 ms | baseline | working (recorded Space baseline ≈ 54.9 ms) |
| 320 FP32 (`yolo_posecoach_v1_320.onnx`) | 6.6 ms | **−74%** | **working, already exported** |
| 640 INT8 (`yolo_posecoach_v1_int8.onnx`) | 20.1 ms | −20% | **collapsed** (score = 0.000) |

Recorded FP32 accuracy baseline (from training): **OKS-mAP@0.50 = 0.9126** (mAP@0.50:0.95 = 0.7638).

### Decision
**Adopt the 320-resolution model as the latency fix. Defer INT8.**
- 320 gives ~3.5× the latency win of INT8 and it is not broken.
- INT8 collapsed because the end-to-end quantization included the score-decode / TopK head,
  wiping the confidence path; it also could only use MinMax calibration locally (histogram
  calibrators OOM at >15 GB). Even repaired (head excluded), its local win was ~20%.
- INT8 stays a **future stack-on**: quantize the *320* model backbone/neck only (head excluded)
  if we ever need more. Not now.

### Risks
1. **Accuracy loss from lower resolution** — 320 loses keypoint precision, worst for small/distant
   subjects; gym close-ups are the favourable case. → Must be measured, not assumed.
2. **Frozen-core touch** — changing input size / model file lives in the inference path
   (`imgsz`, model load). → Ship behind an env flag, code path unchanged, Leader sign-off before merge.
3. **Missing val split** — the labeled `yolo_pose` val set is not local, so the exact OKS-mAP
   recheck is blocked until it's recovered (Drive / re-generate).

---

## ML Engineer — the 320 model + how we judge it

The 320 export already exists (`models/yolo_posecoach_v1_320.onnx`). No new training or export needed.

**Local accuracy proxy (available now, no val split):** compare the 320 model's keypoints to the
640 model's on ~150 in-domain images, in normalized coordinates, via OKS — plus detection-count parity.
Implemented in `notebooks/quantize_int8_local.py` (final section).
- **Ship gate (proxy):** mean OKS ≥ **0.97** AND 320 detects a person on ≈ the same frames as 640.
- If OKS < 0.97 or 320 misses detections 640 caught → 320 too lossy; try an intermediate size
  (448 or 512) or repair-then-stack INT8.

**Formal accuracy gate (needs val split):** recompute OKS-mAP@0.50 for the 320 model on the labeled
val set; require it **within 2% of 0.9126** and still ≥ 0.75 (the P01 thesis gate). This is the
number that goes in the evaluation chapter.

---

## Backend / DevOps — branch & one-flag revert

- **Branch:** `perf/low-latency-320` off `main`. Nothing merges until gates pass.
- **Ship the 320 ONNX as a new artifact** alongside the 640 file — never overwrite it.
- **Env flag** selects it, e.g. `POSE_INPUT_SIZE=320|640` (default `640`), mapping to the 320 vs 640
  ONNX + matching `imgsz`. Loading code unchanged; only which file/size is read.
- **Rollback = set `POSE_INPUT_SIZE=640` and redeploy** (seconds). Full revert = delete the branch.
- Because this touches the frozen inference path indirectly, get explicit Leader sign-off before merge.

---

## QA / Thesis Advisor — acceptance gates

Measure **on the HF Space CPU** (the real target), same frames, before/after.
- **Latency gate:** target a large p50 cut on the Space (320 should far exceed the earlier ≥30–40% aim).
  Report p50 and p95.
- **Accuracy gate (hard):** 320 OKS-mAP@0.50 within **2%** of 0.9126 on the val split; **no rep-count
  regression** and **no form-score-stability regression** (these matter most to users; smoothers absorb
  minor jitter).
- **Rollback trigger:** accuracy fails the gate, or rep-count regresses → `POSE_INPUT_SIZE=640`, branch
  stays unmerged; escalate to intermediate resolution.
- **Standard quality gate (unchanged):** `ruff check app/ --fix`, `mypy app/ --strict`,
  `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`.

---

## Stage → gate → push plan

1. **Proxy check (local, now).** Run the updated script; record 320-vs-640 mean OKS + detection parity.
   *Gate:* mean OKS ≥ 0.97 and detection parity.
2. **Recover the val split.** From Drive, or re-generate via P01. *Gate:* labeled val set reachable.
3. **Formal accuracy.** OKS-mAP@0.50 of 320 vs 0.9126 on the val split.
   *Gate:* within 2% and ≥ 0.75.
4. **Wire the flag.** Add 320 artifact + `POSE_INPUT_SIZE` (default 640); loading code unchanged.
   *Gate:* flag flips size; default path unchanged; quality gate green.
5. **Measure on the Space.** Deploy to a staging Space, record p50/p95 latency 320 vs 640.
   *Gate:* large latency cut confirmed; kids no longer feel lag on a real test.
6. **(Optional, later) INT8 stack.** Quantize the 320 model backbone/neck only (head excluded, QDQ,
   per-channel). Only if more speed is needed. *Gate:* same accuracy gate as step 3.
7. **PR to `main`** with before/after latency + accuracy, flagged for Leader sign-off. **STOP.**

---

## Open items (separate from shipping 320)
- **Recover the labeled `yolo_pose` val split** — blocks the formal accuracy number.
- **Color-order finding:** local probe showed FP32 scores markedly higher with **RGB** input, but the
  production `OnnxPoseSession` feeds **BGR** "for parity with the `.pt` path." If real, the live app may
  be running the model on the wrong channel order and quietly losing accuracy. Worth a focused check —
  frozen-core, so investigate and report before any change.

---

## Leader's summary
Benchmarking redirected the plan: **the 320-resolution model is the latency fix, not INT8.** It's
~74% faster locally, already exported, and not broken, whereas INT8 collapsed and only bought ~20%.
Ship 320 behind `POSE_INPUT_SIZE` (default 640) so rollback is one flag. Decide with accuracy: pass the
local OKS-drift proxy (≥ 0.97) now, then the formal OKS-mAP@0.50-within-2%-of-0.9126 gate once the val
split is recovered, confirming the latency win on the Space. INT8 remains an optional later stack on the
320 model with the head excluded. **Next step:** run the proxy check and read the 320-vs-640 OKS number.
