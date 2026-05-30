# YOLO26-Pose Rules — Read Before Touching Inference Code

## Model Identity
- Architecture: NMS-free end-to-end (dual-head) | DFL removed | RLE for pose keypoints
- Dev: `yolo26n-pose.pt` | Prod: `yolo26n-pose-posecoach-v1.onnx`
- Training: **Google Colab only** (RTX 3050 4GB OOMs on batch>4)

## ⚠️ Dual-Head Architecture — Critical to Understand
YOLO26 has TWO heads:
| Head | Default? | NMS needed? | Output shape | When to use |
|------|---------|------------|-------------|-------------|
| One-to-one | ✅ YES | ❌ No | `(N, 300, 6)` | Always — this is PoseCoach |
| One-to-many | ❌ No | ✅ Yes | `(N, nc+4, 8400)` | Never for this project |

**NEVER pass `end2end=False`** to predict/val/export. It silently switches to the NMS head and breaks everything. This is the #1 subtle bug risk with YOLO26.

```python
# CORRECT — uses one-to-one head (NMS-free, default)
results = model.predict(frame, verbose=False)

# WRONG — silently switches to NMS head
results = model.predict(frame, verbose=False, end2end=False)
```

## Hard Rules (Never Break)
1. **NMS-free** — NEVER call any NMS function after `model.predict()` (one-to-one head handles this)
2. **No `end2end=False`** — never pass this; it enables the NMS head
3. **Keypoints via `.xyn`** — `results[0].keypoints.xyn` (normalized). Never `.boxes` for pose
4. **Load once** — `app.state.model` in lifespan. Never per-request
5. **Executor** — `await loop.run_in_executor(executor, lambda: model.predict(...))`. Never on async loop
6. **nc=1** — person class only. Exercise type from UI, not model
7. **VRAM** — `torch.cuda.empty_cache()` every 100 frames

## Result Parsing (One-to-One Head)
```python
results = model.predict(frame, verbose=False)
# results[0].keypoints.xyn → shape (num_persons, 17, 2) normalized coords
# results[0].keypoints.conf → shape (num_persons, 17) confidence scores
# Confidence gate: skip keypoints with conf < 0.5
# Max 300 detections per image (one-to-one head limit)
```

## ONNX Export (with fuse — Required for Optimal Performance)
```python
model.fuse()  # ← MUST call before export: merges Conv+BN, removes auxiliary head
model.export(format='onnx', imgsz=640, simplify=True, opset=17, dynamic=False)
# dynamic=False = static shape = fastest CPU inference
```

## Dataset Format (Never Change)
- `nc=1`, `kpt_shape:[17,3]`, `flip_idx:[0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15]`
- Visibility: `2`=visible, `0`=not labeled (NEVER `1`)
- Label fields: 1+4+17×3 = **56 fields** per line

## Two-Stage Training
- Stage 1: `freeze=10, optimizer='AdamW', lr0=0.001, pose=12.0` (20 epochs)
- Stage 2: `freeze=None` from Stage 1 best.pt (30 epochs)
- NEVER `optimizer='auto'` — overrides lr0

## Official Benchmarks (yolo26n-pose, COCO)
| Metric | Value |
|--------|-------|
| mAPpose50 (e2e) | 83.3 |
| mAPpose50-95 (e2e) | 57.2 |
| CPU ONNX latency | 40.3 ± 0.5 ms |
| T4 TensorRT latency | 1.8 ms |
| Params | 2.9M |

PoseCoach end-to-end budget: 40.3ms (YOLO) + 5ms (pre) + 0.5ms (EMA smoother) + 2ms (angles) + 10ms (WS) = **~58ms** → well within 100ms p95 target.

## Model Size Upgrade Path (If mAP Target Fails)
| Model | CPU ONNX | mAPpose50 | Use when |
|-------|---------|-----------|----------|
| yolo26n-pose | 40.3ms | 83.3 | Default — dev + prod |
| yolo26s-pose | 85.3ms | 86.6 | If n-pose mAP < 0.75 after finetuning |
| yolo26m-pose | 218ms | 89.6 | Thesis accuracy baseline only (too slow for prod) |

## RLE for Keypoint Accuracy (Thesis)
YOLO26-pose uses Residual Log-Likelihood Estimation (RLE) for probabilistic keypoint localization — cite this in the methodology chapter. Reference: [arxiv.org/abs/2107.11291](https://arxiv.org/abs/2107.11291)

## Thesis Citation (BibTeX)
```bibtex
@software{yolo26_ultralytics,
  author  = {Glenn Jocher and Jing Qiu},
  title   = {Ultralytics YOLO26},
  version = {26.0.0},
  year    = {2026},
  url     = {https://github.com/ultralytics/ultralytics},
  license = {AGPL-3.0}
}
```

## Ultralytics solutions.AIGym — Know It, Don't Replace With It
Ultralytics ships a built-in workout monitoring solution:
```python
from ultralytics import solutions
gym = solutions.AIGym(kpts=[6, 8, 10])  # e.g. hip=6, knee=8, ankle=10 for squat
```
**What it does:** tracks ONE angle between 3 keypoints per exercise and counts reps via threshold crossing.

**Why PoseCoach does NOT use it as the primary scorer:**
- AIGym tracks a single angle triplet — PoseCoach tracks multiple joints simultaneously (full-body form)
- AIGym uses hard thresholds — PoseCoach uses Fit3D-derived ANGLE_RANGES (biomechanically grounded)
- AIGym gives a rep count — PoseCoach gives a 0–100 form score + natural language coaching cues

**Where AIGym IS useful:**
- Thesis baseline comparison: AIGym vs. our multi-joint Fit3D scorer is a clean contribution story
- The `kpts` convention (e.g. `[hip_idx, knee_idx, ankle_idx]`) informs how we define joint triplets in `angle_ranges.json`
- Rep counter cross-check: if our `rep_counter.py` behaves oddly, compare output to AIGym's count

**Thesis framing:** "We extend the single-angle AIGym baseline with multi-joint Fit3D-calibrated scoring, achieving richer form assessment."
