# scripts/ — Dataset Tools & Thesis Evaluation Scripts

## What This Directory Is
Two types of scripts live here: dataset preparation (run once in Prompt 01) and
thesis evaluation (run in Prompt 10, then repeatedly before submission).

## Script Execution Order

### Dataset Pipeline (Prompt 01 — run in order)
```
1. download_kaggle.py          → downloads hasyimabdillah/workoutfitnessvideo
2. extract_frames.py           → extracts frames at 1 FPS (avoids near-duplicates)
3. extract_keypoints.py        → YOLO26 keypoint extraction → data/keypoints/*.npy
4. prepare_yolo_dataset.py     → YOLO pose format, STRATIFIED 80/20 split by clip ID
5. baseline_eval.py            → OKS-mAP baseline on pretrained yolo26n-pose.pt
6. finetune_yolo.py            → fine-tunes on gym dataset (always run, never skip)
```

### Thesis Evaluation Pipeline (Prompt 10 — run in order via /thesis-eval)
```
eval_yolo.py               → OKS-mAP@0.50 gate (>= 0.75)
eval_latency.py            → p95 latency gate (< 100ms CPU)
eval_form_consistency.py   → variance gate (< 5% across 7 exercises)
eval_chatbot.py            → chatbot accuracy gate (>= 80% on 50 Q&A pairs)
eval_user_study.py         → SUS score gate (>= 70, n >= 10)
export_thesis_tables.py    → generates CSV + PNG + LaTeX for thesis
```

## Rules for ALL Scripts
- **Idempotent** — safe to re-run; overwrite output, never append
- **Independently runnable** — no cross-script imports or shared state
- **Output timestamped JSON** — include model version and hardware spec
- **Hard exit codes** — `sys.exit(1)` if quality gate fails, `sys.exit(0)` if passes
- **batch_size=1** for all inference — matches real-time deployment

## Output Paths
```
data/eval/yolo_results.json          ← eval_yolo.py
data/eval/latency_results.json       ← eval_latency.py
data/eval/consistency_results.json   ← eval_form_consistency.py
data/eval/chatbot_results.json       ← eval_chatbot.py
data/eval/sus_responses/             ← participant JSON files
data/thesis/                         ← CSV + PNG + LaTeX (from export_thesis_tables.py)
```

## Metric Targets (Reference)
| Script | Metric | Target |
|---|---|---|
| eval_yolo.py | OKS-mAP@0.50 | >= 0.75 |
| eval_latency.py | p95 CPU latency | < 100ms |
| eval_form_consistency.py | Score variance | < 5% |
| eval_chatbot.py | Chatbot accuracy | >= 80% on 50 pairs |
| eval_user_study.py | SUS score | >= 70 |

## What Does NOT Go Here
- App code → `app/`
- Test files → `tests/`
- Raw data → `data/` (gitignored)
