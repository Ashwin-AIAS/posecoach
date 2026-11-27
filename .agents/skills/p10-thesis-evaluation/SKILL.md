---
name: p10-thesis-evaluation
description: PoseCoach P10 — Full thesis evaluation pipeline. Run all eval scripts, collect metrics, generate LaTeX tables, and prepare final thesis results. Auto-invoked when working on thesis evaluation, metrics collection, user study, or final results.
---

# P10 — Thesis Evaluation

## Goal
Run the complete evaluation pipeline across all thesis metrics, collect results from real users (user study), generate publication-ready tables, and produce the data needed for the thesis evaluation chapter.

## Key Scripts (Run in Order)
```bash
python scripts/eval_yolo.py                # mAP, precision, recall
python scripts/eval_latency.py             # inference latency p50/p95/p99
python scripts/eval_form_consistency.py    # form score variance on identical inputs
python scripts/eval_chatbot.py             # RAG retrieval + response accuracy (50 Q&A pairs)
python scripts/eval_user_study.py          # parse SUS survey responses
python scripts/export_thesis_tables.py     # generate all output tables
```

## Thesis Metrics & Targets (Authoritative — from scripts/GEMINI.md)
| Metric | Target | Script |
|--------|--------|--------|
| YOLO mAP@0.5 | > 0.70 | eval_yolo.py |
| Inference latency p95 | **< 100ms** | eval_latency.py |
| Form score consistency | **< 5% variance** on 20 identical inputs | eval_form_consistency.py |
| Chatbot accuracy | **≥ 80%** on 50 Q&A pairs | eval_chatbot.py |
| User study SUS score | **≥ 70** (System Usability Scale), **n ≥ 10** participants | eval_user_study.py |
| Test coverage (app/analysis) | ≥ 80% | pytest --cov |
