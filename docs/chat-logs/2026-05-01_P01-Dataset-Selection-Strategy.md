# Chat Log — P01 Dataset Selection & Thesis Strategy
**Date:** 2026-05-01  
**Conversation ID:** d6d4088c-dbca-4bc2-afbf-709c84e148e7

---

## 🎯 Objective
Determine the optimal dataset strategy for the PoseCoach thesis, balancing model robustness (CV) and biomechanical accuracy (Form Correction/RAG).

## 📊 Dataset Analysis

| Dataset | Role | Pros | Cons |
|---|---|---|---|
| **Fit3D** | **Primary (GT)** | 3D Vicon Mocap, 25 joints, Rep segments. | Academic access required. |
| **Kaggle Workout**| **Secondary (Train)** | 22 gym exercises, real-world variety. | No keypoint annotations. |
| **M3GYM** | *Reference* | Expert quality labels, multi-view. | High complexity, 47M frames. |
| **MPII** | *Excluded* | General pose (public). | Non-gym specific, redundant with COCO. |

## 💡 Key Decisions & Strategy

### 1. The "Strategic Dual-Dataset" Approach
- **Kaggle Workout** is used for **Domain Adaptation**. Finetuning YOLO26 on these videos teaches the model to handle gym-specific lighting, backgrounds, and equipment.
- **Fit3D** is used for **Calibration & Validation**. Its 3D ground-truth skeletons define the "Golden Angle" ranges in `ANGLE_RANGES` and validate the `rep_counter.py`.

### 2. Why Not Combine All Four?
- **Annotation Inconsistency:** Mapping 16 (MPII) to 25 (Fit3D) to 17 (COCO) joints introduces noise and "Technical Debt."
- **Noise vs. Signal:** MPII (gardening, dancing) adds non-gym noise that can confuse a specialized fitness model.
- **Computational Cost:** Processing M3GYM (47M frames) exceeds free Colab/Drive tier limits.
- **Methodological Rigor:** A clean, subject-independent split is easier to maintain with two controlled datasets.

### 3. YOLO26 Context
- YOLO26 is pre-trained on **COCO Keypoints** (17 joints).
- COCO effectively supersedes MPII for general-purpose human pose detection.
- This allows us to focus purely on "Gym Intelligence" during finetuning.

## 📝 Thesis Justification (Supervisor Script)
> *"I’ve adopted a dual-dataset methodology to resolve the trade-off between visual robustness and biomechanical precision. I use the Kaggle Workout dataset to ensure YOLO26 performs reliably across diverse gym environments, while utilizing the Fit3D dataset’s marker-based 3D ground truth to calibrate accurate form-scoring thresholds. This ensures the RAG-based coaching feedback is evidenced by high-fidelity motion-capture data."*

---

## ✅ Next Steps
1. **Apply for Fit3D Access:** [fit3d.imar.ro/download](https://fit3d.imar.ro/download)
2. **Execute Colab P01:** Finetune YOLO26 on Kaggle videos first (independent of Fit3D).
3. **P02 Integration:** Use Fit3D JSON metadata to export `ANGLE_RANGES` once access is granted.
