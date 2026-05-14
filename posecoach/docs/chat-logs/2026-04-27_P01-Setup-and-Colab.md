# Chat Log — P01 Environment Setup & Colab Notebook
**Date:** 2026-04-27  
**Conversation ID:** 603085b7-bf39-4a57-931f-cf1c5790088b

---

## What Was Done

### 1. Virtual Environment & Dependencies
- Activated venv: `.\venv\Scripts\Activate.ps1` → `(gymvision)` prompt
- Discovered previous `pip install -r requirements.txt` **had failed silently** — only `pypdf` was installed
- Re-ran `pip install -r requirements.txt` — **all 50+ packages installed successfully**
- Verified with `pip list` and `pip check` — all good ✅
- Upgraded pip: `24.0 → 26.1`

### 2. Cloud Storage Decision
- **Problem:** Local disk/memory constraints for large datasets (YOLO training data)
- **Solution:** Use **Google Drive (5TB, 77.93GB used)** + **Google Colab (free T4 GPU)**
- Dataset stays in Drive, training runs on Colab, only weights (~6MB) come back to local

### 3. Colab Notebook Created: `PoseCoach_P01_Colab.ipynb`
**Location:** `posecoach/docs/PoseCoach_P01_Colab.ipynb`

#### Steps in the notebook:
1. Mount Google Drive & verify GPU
2. Upload Kaggle API key (`kaggle.json`)
3. Install dependencies (ultralytics, kaggle, opencv, etc.)
4. Download dataset: `hasyimabdillah/workoutfitnessvideo`
5. Extract frames at 1 FPS
6. Extract YOLO26 keypoints (`.xyn` normalized — NOT `.xy`)
7. Prepare YOLO pose dataset (80/20 stratified split by clip ID)
8. Baseline evaluation (pretrained YOLO26n-pose)
9. **Two-stage finetune** (from Ultralytics guide)
10. Save final weights & evaluate against thesis gate (mAP@0.50 ≥ 0.75)

### 4. Ultralytics Best Practices Applied
**Source:** https://docs.ultralytics.com/guides/finetuning-guide/

| Setting | Why |
|---|---|
| **Two-stage training** | Stage 1: freeze backbone (20 epochs), Stage 2: unfreeze all (30 epochs) — prevents catastrophic forgetting |
| **`optimizer='AdamW'`** (explicit) | `auto` silently overrides `lr0` — must set explicitly |
| **`lr0=0.0005`** in Stage 2 | Lower LR preserves backbone features |
| **`mosaic=0.5`** | Heavy augmentation hurts small gym datasets |
| **`patience=15`** | Guide recommends 10-20 for finetuning |
| **`freeze=10`** in Stage 1 | Freezes layers 0-9 (backbone) in YOLO26 |

### 5. Model Fix: yolo11n → yolo26n
- Original notebook incorrectly used `yolo11n-pose.pt`
- Fixed ALL references to `yolo26n-pose.pt` (matches CLAUDE.md spec)
- Added reminder: YOLO26 is **NMS-free** — NEVER add NMS after predict

---

## Key Files
| File | Purpose |
|---|---|
| `docs/PoseCoach_P01_Colab.ipynb` | P01 Colab notebook (upload to colab.google.com) |
| `requirements.txt` | Python dependencies (all installed in venv) |
| `CLAUDE.md` | Project memory & architecture rules |
| `scripts/CLAUDE.md` | Script execution order for P01 |

## Next Steps
1. Upload notebook to [Google Colab](https://colab.research.google.com)
2. Set runtime to **T4 GPU**
3. Get Kaggle API key from https://www.kaggle.com/settings → API → Create New Token
4. Run all cells in order (~2-3 hrs total)
5. Download `yolo_posecoach_v1.pt` from Drive → `posecoach/models/`
6. Update `.env`: `MODEL_PATH=models/yolo_posecoach_v1.pt`
7. Proceed to **P02 — Infrastructure**

---

## Commands Reference
```powershell
# Activate venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Verify packages
pip list | Select-String "fastapi|torch|chromadb|ultralytics"
pip check

# Start server
uvicorn main:app --reload
```
