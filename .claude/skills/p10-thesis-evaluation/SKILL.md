---
name: p10-thesis-evaluation
description: PoseCoach P10 — Full thesis evaluation pipeline. Run all eval scripts, collect metrics, generate LaTeX tables, and prepare final thesis results. Auto-invoked when working on thesis evaluation, metrics collection, user study, or final results.
allowed-tools: Read, Write, Edit, Bash
---

# P10 — Thesis Evaluation

## Goal
Run the complete evaluation pipeline across all thesis metrics, collect results from real users
(user study), generate publication-ready tables, and produce the data needed for the thesis
evaluation chapter.

## Key Scripts (Run in Order)
```bash
python scripts/eval_yolo.py                # mAP, precision, recall
python scripts/eval_latency.py             # inference latency p50/p95/p99
python scripts/eval_form_consistency.py    # form score variance on identical inputs
python scripts/eval_chatbot.py             # RAG retrieval + response accuracy (50 Q&A pairs)
python scripts/eval_user_study.py          # parse SUS survey responses
python scripts/export_thesis_tables.py     # generate all output tables
```

## Thesis Metrics & Targets (Authoritative — from scripts/CLAUDE.md)
| Metric | Target | Script |
|--------|--------|--------|
| YOLO mAP@0.5 | > 0.70 | eval_yolo.py |
| Inference latency p95 | **< 100ms** | eval_latency.py |
| Form score consistency | **< 5% variance** on 20 identical inputs | eval_form_consistency.py |
| Chatbot accuracy | **≥ 80%** on 50 Q&A pairs | eval_chatbot.py |
| User study SUS score | **≥ 70** (System Usability Scale), **n ≥ 10** participants | eval_user_study.py |
| Test coverage (app/analysis) | ≥ 80% | pytest --cov |

**Do NOT use Likert averages (>4.0/5) as metrics — the actual targets are above.**

## Form Consistency Metric (eval_form_consistency.py)
- Feed the same 20 keypoint arrays to `form_scorer.py` repeatedly
- Measure variance in output scores — must be < 5% (i.e. deterministic/stable)
- This catches numerical instability and non-determinism in the scoring pipeline

## Chatbot Accuracy (eval_chatbot.py)
- 50 curated Q&A pairs about form coaching
- Automatic grading: response contains the correct answer keyword(s)
- Target: ≥ 80% correct (40/50)
- Use `respx` to replay API responses — do NOT hit live Gemini/Qwen during eval

## User Study Protocol (SUS)
- **Minimum 10 participants** (gym-goers, not CS experts)
- Tasks: perform 3 exercises with PoseCoach coaching, then fill out SUS
- SUS = System Usability Scale (10 questions, 1–5 each → 0–100 score)
- **Target: SUS ≥ 70** (industry "good" threshold)
- Anonymize: participant IDs only, no names in DB or thesis

## Qwen 3.6 as VLM Judge (⭐ Novel Thesis Contribution)
```python
# In eval_form_consistency.py
# Send: frame + YOLO keypoint-based score + ground truth annotation
# Ask Qwen to judge agreement between YOLO score and visual reasoning
# Metric: "Agreement rate between geometric (YOLO) and VLM-based analysis"
```
- Use OpenRouter API with `qwen/qwen-vl-plus` or similar
- Novel contribution: hybrid geometric + VLM cross-validation
- This is a cross-check metric, not the primary score

## Output Files (in data/thesis_tables/)
- `table_yolo_metrics.csv` — detection + pose metrics
- `table_latency.csv` — latency percentiles (p50/p95/p99) under various loads
- `table_form_accuracy.csv` — per-exercise form scoring accuracy
- `table_form_consistency.csv` — variance across 20 identical inputs
- `table_chatbot_eval.csv` — chatbot accuracy scores (n=50)
- `table_user_study.csv` — SUS scores per participant + final SUS score
- `thesis_summary.csv` — one-row summary of all metrics vs. targets

## Done Criteria
- [ ] All 6 eval scripts run without errors
- [ ] All metrics meet or exceed targets (document if any fall short — be honest)
- [ ] `data/thesis_tables/` populated with all 7 CSVs
- [ ] SUS score calculated from raw responses using standard formula
- [ ] `thesis-writer` agent used to draft §5 Evaluation chapter
- [ ] LaTeX tables generated and copy-ready for thesis doc

## Thesis Metric
This prompt IS the thesis metrics — it's the culmination of P01–P09.
