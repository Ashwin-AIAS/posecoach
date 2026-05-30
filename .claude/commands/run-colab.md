# /run-colab

Step-by-step guide to run the P01 Colab notebook from scratch.

## Prerequisites
- Google account with Google Drive access
- Kaggle account + `kaggle.json` API token
- Colab free tier (T4 GPU) or Colab Pro (A100 recommended)

## Steps

### 1. Open Notebook
1. Go to [colab.research.google.com](https://colab.research.google.com)
2. File → Open → Google Drive → navigate to `GYMVISION AI/`
3. Open `PoseCoach_P01_Colab.ipynb`

### 2. Set Runtime
- Runtime → Change runtime type → **T4 GPU** → Save
- Verify: first cell should print your GPU name

### 3. Run in Order — Each Cell Caches Progress
The notebook is idempotent — already-completed steps are skipped:
```
Step 1  → Mount Drive + create folders
Step 2  → Upload kaggle.json (do this manually each session)
Step 3  → pip install (cached after first run)
Step 4  → Download Kaggle dataset (~2GB, cached if exists)
Step 5  → Extract frames at 2 FPS (~30 min first run, cached)
Step 6  → Extract YOLO26 keypoints (~45 min first run, cached)
Step 7  → Prepare YOLO dataset + 80/20 split
Step 8  → Baseline evaluation (verify labels before training)
Step 9  → Two-stage training (Stage 1: ~20 min, Stage 2: ~30 min on T4)
Step 10 → Save weights + evaluate OKS-mAP
Step 10b → ONNX export + CPU latency benchmark
Step 10c → Joint angle MAE evaluation
Step 11 → Fit3D pipeline (SKIP if Fit3D not downloaded yet)
Step 12 → Rep counter validation (SKIP if Fit3D not downloaded)
```

### 4. Fit3D (Optional — Can Skip for P02)
- Requires manual download from fit3d.imar.ro
- Upload to `MyDrive/GYMVISION AI/datasets/fit3d/raw/` before Step 11
- If skipping: use a placeholder `angle_ranges.json` for P02 development

### 5. After Colab Finishes
Run `/sync-drive` for exact local file sync instructions.

## Common Issues
| Issue | Fix |
|-------|-----|
| "NO GPU" warning | Runtime → Change runtime type → T4 |
| Kaggle 403 | Re-upload kaggle.json in Step 2 |
| OOM during training | Change `batch=16` to `batch=8` in Step 9 |
| Session disconnected | Re-run from last incomplete step; Drive cache saves prior steps |
| Stage 1 not found | Verify `MODELS_DIR/runs/posecoach_stage1/weights/best.pt` exists |

## Expected Runtimes (T4 GPU)
- Steps 1–6: ~1–2 hours first run (mostly frame extraction + keypoints)
- Steps 7–8: ~10 minutes
- Step 9 (training): ~50 minutes total (Stage 1 + Stage 2)
- Steps 10–10c: ~20 minutes
- **Total: ~2.5–3.5 hours** (spread across multiple sessions using Drive cache)
