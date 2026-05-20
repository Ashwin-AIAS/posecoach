# Model Weights

Model weights are stored in Google Drive (too large for git — 7.5 MB `.pt`, 12 MB `.onnx`).

## Download

**Google Drive path:** `MyDrive/GYMVISION AI/models/`

Files needed:
| File | Size | Purpose |
|------|------|---------|
| `yolo_posecoach_v1.pt` | 7.5 MB | PyTorch weights — dev/finetuning |
| `yolo_posecoach_v1.onnx` | 12 MB | ONNX weights — production CPU inference |

## Quick Download (Colab/Drive)

```python
import shutil
shutil.copy('/content/drive/MyDrive/GYMVISION AI/models/yolo_posecoach_v1.pt', 'models/')
shutil.copy('/content/drive/MyDrive/GYMVISION AI/models/yolo_posecoach_v1.onnx', 'models/')
```

## Training

These weights were produced by P01 two-stage YOLO26-Pose finetuning.
See `docs/PoseCoach_P01_Colab.ipynb` or `docs/PoseCoach_P01_Kaggle.ipynb` to reproduce.

## Results

| Metric | Value | Thesis target | Status |
|--------|-------|---------------|--------|
| mAP@0.5 | 0.913 | > 0.70 | PASS |
| Latency p95 (ONNX CPU) | 57.2 ms | < 100 ms | PASS |

Full results in `data/eval/`.
