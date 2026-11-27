# /thesis-eval

Run the full thesis evaluation pipeline and generate results tables.

## Steps
1. **Run all eval scripts in order:**
   ```bash
   python scripts/eval_yolo.py
   python scripts/eval_latency.py
   python scripts/eval_form_consistency.py
   python scripts/eval_chatbot.py
   python scripts/eval_user_study.py
   ```
2. **Export thesis tables:**
   ```bash
   python scripts/export_thesis_tables.py
   ```
3. **Summarize results** against targets (mAP > 0.70, latency p95 < 100ms, form variance < 5%, chatbot ≥ 80%, SUS ≥ 70).
