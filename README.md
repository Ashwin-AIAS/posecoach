---
title: PoseCoach API
emoji: 🏋️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 8000
pinned: false
short_description: Real-time AI gym form correction backend (YOLO26 + RAG)
---

# PoseCoach AI 🏋️‍♂️🤖

> **A Vicon-Validated Real-Time Pose Assessment and RAG-Augmented Coaching System for Resistance Training**
>
> *Master's Thesis Project by Ashwin Vignesh*

---

## 📌 Research Question & Core Goal

To what extent can a **YOLO26-Pose-based** mobile system achieve clinically acceptable joint angle accuracy (**MAE ≤ 5°**), sub-80 ms end-to-end inference latency on CPU, and meaningful user-perceived coaching effectiveness (**SUS ≥ 70**) for resistance training form correction under real gym conditions — and does integrating a domain-specific RAG chatbot produce measurably superior coaching quality compared to visual feedback alone?

---

## 🛠️ Project Structure at a Glance

This repository contains the complete codebase, evaluation notebook pipeline, documentation sheets, and thesis defense package for the PoseCoach system.

```
posecoach-root/
├── posecoach/                       # Full-Stack Application Subdirectory
│   ├── app/                         # FastAPI Backend (Python 3.11)
│   ├── frontend/                    # React 18 PWA (Vite + TypeScript + Tailwind)
│   ├── alembic/                     # Database Migrations (PostgreSQL)
│   ├── tests/                       # Pytest Suite (97% coverage target)
│   ├── e2e/                         # Playwright E2E testing
│   ├── deploy/                      # Docker Compose & Monitoring stack config
│   └── docs/                        # Complete internal docs & chat logs
├── posecoach_p02_fit3d_clean.ipynb  # Fit3D Dataset Preprocessing & Cleaning
├── posecoach_p02_fit3d_colab.ipynb  # Google Colab T4 Training & Fine-Tuning Pipeline
├── posecoach_p02_fit3d_kaggle.ipynb # Kaggle Dataset Integration & Evaluation Pipeline
├── PoseCoach_Claude_Cheatsheet.md   # Daily Workspace Cheatsheet & Gotchas
└── PoseCoach_Defense_Package.md     # Comprehensive Defense Prep & Ablation Protocol
```

---

## 🏆 PoseCoach vs. Ultralytics AIGym

PoseCoach represents a major paradigm shift from simple binary rep-counting utility packages to professional, clinically validated clinical pose-assessment systems.

| Dimension | Ultralytics AIGym | PoseCoach (This Thesis) |
| :--- | :--- | :--- |
| **Primary Purpose** | Rep counting | Real-time form quality assessment + corrective coaching |
| **Pose Model** | Pretrained YOLO-Pose (COCO weights) | YOLO26-Pose fine-tuned on gym-domain data (dual-dataset strategy) |
| **Ground Truth Validation** | None reported; no accuracy claims against clinical reference | Validated against Vicon marker-based motion capture (25-joint 3D skeletons) |
| **Accuracy Metric** | Not applicable (binary up/down classification) | Mean Absolute Error (MAE) on joint angles, target **≤ 5°** |
| **Form Assessment** | None — only detects whether angle crossed a threshold | Multi-joint angle analysis with exercise-specific correctness criteria |
| **Feedback Mechanism** | Visual overlay (rep count displayed on frame) | Visual overlay + natural-language corrective cues + RAG chatbot |
| **Exercise Coverage** | 3 types (pushup, pullup, abworkout) | **47 exercise types** across warmups, barbell, dumbbell, and equipment-free |
| **Keypoint Usage** | 3 keypoints per exercise (e.g., shoulder-elbow-wrist) | Full 17-keypoint skeleton; exercise-specific joint subsets for angle computation |
| **Temporal Analysis** | None — frame-by-frame only | Rep segmentation with phase detection (eccentric/concentric); tempo analysis |
| **Architecture** | Python script (CLI or OpenCV loop) | Full-stack system: FastAPI backend, WebSocket inference, React PWA, PostgreSQL |
| **Deployment Target** | Desktop Python environment | Mobile-first PWA; CPU inference target with sub-80 ms latency requirement |
| **Personalization** | None | User history, session tracking, personalized RAG responses |

---

## ⚡ Technical Highlights

### 1. Dual-Dataset Fine-Tuning Pipeline
To prevent catastrophic forgetting while adapting to gym environments, PoseCoach implements a mixed-batch training strategy:
* **Source Domain (COCO Person Pose)**: 30% batch ratio to preserve general body/joint keypoint detection.
* **Target Domain (Gym-Specific / Fit3D / Vicon)**: 70% batch ratio focusing on resistance training movements (Squats, Bicep Curls, Deadlifts, Overhead Presses).
* Check out the [Training Notebook on Colab](posecoach_p02_fit3d_colab.ipynb) and [Evaluation Notebook on Kaggle](posecoach_p02_fit3d_kaggle.ipynb).

### 2. Full-Stack Reactive Architecture (`posecoach/`)
* **Real-time Mobile Pose Overlay**: A 15 FPS camera pipeline built using HTML5 Canvas + `requestAnimationFrame` with backpressure-aware frame dropping.
* **Asynchronous WebSocket Server**: Implements a dedicated ThreadPoolExecutor runner for YOLO26 ONNX inference, decoupling heavy ML forwards from the FastAPI async event loop.
* **Exponential Smoothing Filter (EMA)**: Combines multi-frame coordinate tracking ($\alpha = 0.6$) to eliminate jitter without introducing noticeable latency.
* **RAG-Enabled Coaching**: Intelligently routes gym queries. Text-only questions go to **Gemini 2.0 Flash**, and visual frames are handled via **Qwen 2.5-VL-72B** over open manuals stored in **ChromaDB**.
* **Observability**: Complete Prometheus metrics instrumentation (`posecoach_form_score` distribution, inference latency percentiles, active connections) backed by provisioned Grafana dashboards.

---

## 🚀 Getting Started

### 1. Quick Local Environment Setup
To set up and run the full-stack system locally:
```bash
# Navigate to the project directory
cd posecoach

# Run the environment bootstrap script
# This handles: pyenv -> virtual environment -> pip installs -> Docker services -> Alembic migrations
./.claude/commands/setup-env.sh
```

### 2. Development Workflow (Claude Code)
If you are developing inside this repo using Claude Code, load the workspace and use the integrated shortcuts:
```bash
# Launch Claude Code from within the project directory
claude

# Useful Slash Commands inside Claude:
/verify        # Run Ruff linting, Mypy strict checks, Pytest, and Vitest suite
/checkpoint    # Perform pre-flight credentials scan and generate a structured Git commit
/thesis-eval   # Execute the 6 clinical evaluation scripts in order
```

---

## 📖 Deep Dives & Thesis Artifacts

* 📜 **[PoseCoach Thesis Defense Package](PoseCoach_Defense_Package.md)**: Outlines the ablation experiment protocols, Vicon testing dataset splits, user crossover study design (SUS ≥ 70 target), and expected examiner Q&A.
* 📋 **[PoseCoach Claude Cheatsheet](PoseCoach_Claude_Cheatsheet.md)**: Daily developer one-pager with rules of thumb, major gotchas, and prompt sequences.
* 📓 **[Google Colab Finetuning Guide](posecoach_p02_fit3d_colab.ipynb)**: Detailed step-by-step notebook setup for Model Fine-Tuning.

---

*For any inquiries regarding the thesis defense, experimental protocols, or system architecture, please refer to [PoseCoach_Defense_Package.md](PoseCoach_Defense_Package.md).*
