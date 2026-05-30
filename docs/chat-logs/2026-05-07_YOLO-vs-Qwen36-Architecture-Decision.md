# YOLO26 vs Qwen 3.6 — Architecture Decision Log

**Date:** 2026-05-07
**Topic:** Role of YOLO in thesis + whether to switch to Qwen 3.6
**Decision:** Keep YOLO26-Pose as core, add Qwen 3.6 as complementary VLM in P05 & P10

---

## Context

User saw Qwen 3.6 announced in Roboflow Playground (April 2026) with improvements in visual reasoning and fine-grained attribute detection. Question: should PoseCoach switch from YOLO26-Pose to Qwen 3.6?

---

## Role of YOLO in This Thesis

YOLO26-Pose is the **core perception layer** of the entire PoseCoach system:

1. **Real-Time Pose Estimation** — Takes raw camera frames → outputs 17 COCO-format body keypoints with per-keypoint confidence scores (~5ms per frame)
2. **NMS-Free Architecture** — YOLO26 is end-to-end NMS-free (no post-processing), reducing latency vs older YOLO versions
3. **Feeds Entire Downstream Pipeline:**
   - Angle Calculator → computes joint angles from keypoint coordinates
   - Form Scorer → compares angles against ideal ranges for 7 exercises
   - Rep Counter → tracks keypoint trajectories for repetition counting
   - EMA Smoother → temporal smoothing (α=0.6) of keypoint positions
   - RAG Chatbot → generates form-correction cues based on form scores
4. **Finetuning (P01)** — Domain-adapting YOLO26 on fitness datasets (Fit3D, M3GYM) is a core thesis contribution
5. **Thesis Metrics** — Inference latency, keypoint accuracy, form scoring consistency all measured via eval scripts

---

## Why NOT Switch to Qwen 3.6

| Factor | YOLO26-Pose | Qwen 3.6 |
|---|---|---|
| **Type** | Specialized pose estimation CNN | General-purpose multimodal LLM (27B+ params) |
| **Output** | 17 keypoint (x,y) coordinates + confidence | Natural language text |
| **Speed** | ~2–8 ms/frame (200+ FPS) | ~1–5 seconds/image (<1 FPS) |
| **Structured output** | Exact coordinates for angle math | Descriptive text — can't compute angles |
| **Finetuning** | ✅ On fitness keypoints | ❌ Can't finetune for precise coordinates |
| **VRAM** | Runs on RTX 3050 (4GB) | Needs 16–40+ GB |
| **Deterministic** | Same frame → same keypoints | Stochastic text generation |

**5 thesis-killing reasons Qwen doesn't work as a replacement:**
1. Can't compute joint angles from prose
2. 100–500x too slow for real-time coaching at 15 FPS
3. Entire downstream pipeline expects `(17, 2)` numpy arrays
4. Can't finetune on pose keypoints
5. Using a 27B LLM for a 3M-param task = poor engineering judgment at thesis defense

---

## Decision: Qwen 3.6 as Complementary Tool

Qwen 3.6 will be integrated as a **secondary multimodal reasoning layer**, not a replacement:

```
Camera Frame → YOLO26-Pose (keypoints, ~5ms)  ← Tier 1: Real-time
                    ↓
              Angle Calc → Form Scorer → Cue Generation
                    ↓
        Qwen 3.6 (visual coaching explanation) ← Tier 2: On-demand
```

### P05 — RAG Chatbot (Primary Integration)
- Add Qwen 3.6 as second LLM provider via OpenRouter API (alongside Gemini 2.0 Flash)
- Smart routing: visual queries (with frame snapshot) → Qwen 3.6, text-only → Gemini (cheaper/faster)
- Qwen sees things YOLO keypoints can't: grip width, bar path, foot placement, equipment positioning
- Files: `app/chatbot/llm.py`, `app/chatbot/router.py`
- New env var: `QWEN_API_KEY`

### P10 — Thesis Evaluation (Secondary Integration)
- Use Qwen 3.6 as VLM cross-validation judge for form scoring
- Compare YOLO keypoint-based scores vs Qwen visual reasoning on same test frames
- Novel thesis metric: "Agreement rate between geometric keypoint analysis and VLM-based analysis"
- File: `scripts/eval_form_consistency.py`

---

## Thesis Narrative

> "PoseCoach employs a hybrid two-tier perception strategy: YOLO26-Pose for frame-by-frame keypoint extraction at real-time latency, combined with Qwen 3.6 multimodal VLM for visually-grounded coaching explanations invoked on-demand when richer context is needed beyond skeleton data."

---

## Action Items
- [x] Updated `CLAUDE.local.md` with Qwen 3.6 plan pinned to P05 ⭐ and P10 ⭐
- [ ] Continue with P01 (Dataset Prep & YOLO Finetuning) — next session
- [ ] Implement Qwen 3.6 integration when reaching P05
- [ ] Add VLM cross-validation judge when reaching P10

---

*Logged from Antigravity conversation ee0de33f-2a73-4b88-bbfb-39e48f87266f*
