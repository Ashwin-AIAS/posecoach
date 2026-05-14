---
name: p01-dataset-prep
description: PoseCoach P01 — Dataset Prep & YOLO26-Pose Finetuning. Runs on Google Colab T4 GPU (NOT local). Dual-dataset: Kaggle workout videos + Fit3D mocap. Two-stage training, ONNX export, 4 thesis metrics. Auto-invoked for dataset, training, YOLO finetuning, Colab, Fit3D, ONNX, or model evaluation work.
allowed-tools: Read, Write, Edit, Bash
---

# P01 — Dataset Prep & YOLO26-Pose Finetuning

## ⚠️ Runs on Google Colab — NOT Local
- Local RTX 3050 (4GB VRAM) is too limited for training.
- Notebook: `PoseCoach_P01_Colab.ipynb` — run on Colab T4 (free) or A100 (Colab Pro).
- All outputs save to **Google Drive**: `MyDrive/GYMVISION AI/`
- After Colab finishes, download to local: `posecoach/models/` and `posecoach/data/`

## Dual-Dataset Strategy
### Pipeline 1 — Kaggle Workout Videos → Pose Model
- Source: `hasyimabdillah/workoutfitnessvideo` (Kaggle)
- Purpose: Fine-tune YOLO26-Pose to recognize gym exercise poses
- Output: `yolo_posecoach_v1.pt` + `yolo_posecoach_v1.onnx`

### Pipeline 2 — Fit3D Mocap → Golden Angle Templates
- Source: [fit3d.imar.ro](https://fit3d.imar.ro/download) — requires manual download (authenticated)
- Purpose: Vicon mocap gives sub-degree 3D joint angles → calibrate `form_scorer.py`
- Output: `angle_ranges_compact.json` → copy to `app/analysis/`
- Both 3D angles (thesis reference) AND 2D projected angles (production use) computed

## YOLO Training Config (Critical)
- **nc=1** — person class ONLY, no exercise classification in model
  - Why: nc=7 reinitializes detection head, degrades pretrained features
  - Exercise classification via user selection in UI (not model)
- **flip_idx**: `[0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15]` — must be set in dataset.yaml
- **kpt_shape**: `[17, 3]` — COCO 17-point with visibility
- **Split**: Stratified 80/20 by clip ID (not frame) — prevents data leakage
- **Visibility**: 0=not labeled, 2=visible (COCO convention) — never use 1

## Two-Stage Training (Per Ultralytics YOLO26 Guide)
### Stage 1 — Backbone Frozen (20 epochs)
```python
freeze=10, optimizer='AdamW', lr0=0.001, mosaic=0.5,
close_mosaic=10, warmup_epochs=3, patience=15, pose=12.0
```
### Stage 2 — Full Model (30 epochs)
```python
freeze=None, optimizer='AdamW', lr0=0.001, warmup_epochs=1,
patience=15, pose=12.0
```
- Load Stage 2 from Stage 1 best weights
- NEVER use `optimizer='auto'` — it overrides `lr0`

## ONNX Export (Required for FastAPI)
```python
model.export(format='onnx', imgsz=640, simplify=True, opset=17, dynamic=False)
```
- FastAPI uses ONNX for CPU inference (no CUDA dependency in prod)
- CPU latency target: <80ms end-to-end (YOLO ~39ms + preprocessing ~5ms + angles ~2ms + WS ~10ms)

## 4 Thesis Metrics Evaluated in P01
| Metric | Target | Output File |
|--------|--------|------------|
| OKS-mAP@0.50 | ≥ 0.75 | `data/eval/yolo_results.json` |
| Joint Angle MAE | ≤ 5° | `data/eval/angle_mae_results.json` |
| CPU latency (ONNX, p95) | < 80ms | `data/eval/latency_benchmark.json` |
| Rep counter accuracy | ≥ 90% | `data/eval/rep_counter_validation.json` |

## Google Drive → Local File Transfer
After Colab completes, download to local posecoach project:
```
Drive: MyDrive/GYMVISION AI/models/yolo_posecoach_v1.pt
  → local: posecoach/models/yolo_posecoach_v1.pt

Drive: MyDrive/GYMVISION AI/models/yolo_posecoach_v1.onnx
  → local: posecoach/models/yolo_posecoach_v1.onnx

Drive: MyDrive/GYMVISION AI/datasets/fit3d/angle_templates/angle_ranges_compact.json
  → local: posecoach/app/analysis/angle_ranges.json

Drive: MyDrive/GYMVISION AI/data/eval/
  → local: posecoach/data/eval/
```

## Key Files (Local)
- `PoseCoach_P01_Colab.ipynb` — the notebook (in workspace root)
- `posecoach/app/analysis/form_scorer.py` — loads `angle_ranges.json`
- `posecoach/scripts/eval_yolo.py` — local eval (after downloading weights)
- `posecoach/models/` — model checkpoints

## Done Criteria
- [ ] Colab notebook runs end-to-end without errors
- [ ] `yolo_posecoach_v1.onnx` downloaded to `posecoach/models/`
- [ ] `angle_ranges_compact.json` copied to `app/analysis/angle_ranges.json`
- [ ] OKS-mAP@0.50 ≥ 0.75
- [ ] Joint Angle MAE ≤ 5°
- [ ] CPU latency p95 < 80ms
- [ ] All 4 eval JSON files in `posecoach/data/eval/`
