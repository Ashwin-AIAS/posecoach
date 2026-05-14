# Colab & Google Drive Rules

## When to Use Colab vs Local
| Task | Environment |
|------|-------------|
| YOLO training (any stage) | **Colab T4/A100 only** |
| ONNX export | **Colab** (after training) |
| Dataset frame extraction | **Colab** (large dataset) |
| FastAPI development | Local |
| React frontend dev | Local |
| Docker/infrastructure | Local |
| Quick inference test (single frame) | Local RTX 3050 OK |

**Never suggest training locally** — RTX 3050 (4GB) OOMs on batch>4 with YOLO26n.

## Google Drive Paths
All Colab outputs go to `MyDrive/GYMVISION AI/` (Drive root for this project):
```
MyDrive/GYMVISION AI/
├── datasets/workoutfitness/   ← Kaggle raw data
├── datasets/frames/           ← extracted frames (2 FPS)
├── datasets/keypoints/        ← .npy keypoint files
├── datasets/yolo_pose/        ← YOLO format (train/val splits)
├── datasets/fit3d/
│   ├── raw/                   ← Fit3D manual download target
│   └── angle_templates/       ← golden angle JSONs
├── models/                    ← .pt + .onnx checkpoints
└── data/eval/                 ← all 4 thesis metric JSONs
```

## Post-Colab Local Sync (Always Do This After P01 Colab Run)
Download these files from Drive to local project:
```
Drive: models/yolo_posecoach_v1.pt       → posecoach/models/
Drive: models/yolo_posecoach_v1.onnx     → posecoach/models/
Drive: datasets/fit3d/angle_templates/angle_ranges_compact.json
                                          → posecoach/app/analysis/angle_ranges.json
Drive: data/eval/*.json                  → posecoach/data/eval/
```
Use `/sync-drive` command to get exact instructions.

## Colab Session Management
- Colab free tier disconnects after ~90 min idle — use `drive.mount` + Drive saves to persist
- All intermediate outputs (frames, keypoints) are cached in Drive — cells skip if output exists
- If session disconnects mid-training: re-run from the last incomplete step; all prior steps cached
- **Do NOT re-run Step 7 (label prep) after training starts** — it would reshuffle the split

## Fit3D Manual Download
Fit3D requires authenticated access — cannot be scripted:
1. Go to [fit3d.imar.ro/download](https://fit3d.imar.ro/download)
2. Register and request access
3. Download "Dataset Info" (12KB) + "Training Set" (18GB)
4. Upload to `MyDrive/GYMVISION AI/datasets/fit3d/raw/`
5. Re-run Step 11a in the notebook

## Notebook Location
`PoseCoach_P01_Colab.ipynb` — in workspace root (`GYMVISION AI/`)
Open via: Google Colab → File → Open → Google Drive → navigate to GYMVISION AI
