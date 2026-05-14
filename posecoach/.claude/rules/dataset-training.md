# Dataset & Training Rules

## Dataset Configuration (Never Change These)
- `nc=1` (person) — exercise classification is NOT in the model
- `flip_idx: [0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15]` — symmetric left-right swap
- `kpt_shape: [17, 3]` — COCO 17-point with visibility
- Frame extraction: **2 FPS** from videos (balances coverage vs. redundancy)
- Stratified split: **by clip ID** not by frame (prevents leakage)
- `random.seed(42)` — reproducibility for thesis

## Label Format Validation
Before training, always verify a sample label:
```python
content = label_file.read_text().split()
assert len(content) == 56, f"Expected 56 fields, got {len(content)}"
# class(1) + bbox(4) + 17*3 keypoints = 56
```
If field count is wrong, re-run Step 7 in the Colab notebook.

## ANGLE_RANGES Management
- Lives in `app/analysis/form_scorer.py` as a Python dict
- Source of truth: `app/analysis/angle_ranges.json` (exported from Fit3D)
- Never inline angle ranges in application logic — always read from `ANGLE_RANGES`
- Supported exercises: `squat, deadlift, curl, bench, ohp, lunge, plank`
- Use **2D projected angles** for production (from `angle_ranges_compact.json`)
- Keep **3D angles** in `golden_angle_ranges_3d.json` as thesis reference only

## Rep Counter Rules
- Algorithm: `scipy.signal.find_peaks` on angle time series
- Primary signal: knee flexion (works for most lower-body exercises)
- Parameters: `prominence = std * 0.5`, `distance = 25` (= 0.5s at 50 FPS)
- Validate against Fit3D ground truth (Step 12 in Colab)
- Target accuracy: ≥ 90% rep count vs. ground truth

## Model Versions
| File | Purpose | Where |
|------|---------|-------|
| `yolo26n-pose.pt` | Pretrained base | Ultralytics (auto-download) |
| `yolo_posecoach_v1.pt` | Finetuned PyTorch | `posecoach/models/` |
| `yolo_posecoach_v1.onnx` | Production CPU | `posecoach/models/` |

## Eval JSON Structure (Reference)
```json
// data/eval/yolo_results.json
{"pose_map50": 0.82, "thesis_gate_passed": true}

// data/eval/latency_benchmark.json
{"mean_ms": 42.1, "p95_ms": 67.3, "thesis_gate_80ms": true}

// data/eval/angle_mae_results.json
{"overall_mae_degrees": 3.8, "thesis_gate_5deg": true}

// data/eval/rep_counter_validation.json
{"summary": {"accuracy": 0.94}}
```

## Data Privacy in Training
- Training data (Kaggle): licensed for research use only
- Fit3D: research license — cite in thesis
- User webcam frames: NEVER saved to disk, NEVER used for training
- All eval frames used in Step 10c: from validation set only (no test leakage)
