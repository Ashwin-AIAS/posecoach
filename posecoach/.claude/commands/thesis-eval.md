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
3. **Summarize results** — Show key metrics in a table:
   | Metric | Target | Actual | Status |
   |--------|--------|--------|--------|
   | Inference latency (p95) | <50ms | ? | |
   | Form accuracy (vs. expert) | >85% | ? | |
   | Chatbot relevance score | >4.0/5 | ? | |
   | User study satisfaction | >4.0/5 | ? | |

4. **Flag any metric below target** — Suggest which part of the system to investigate.
5. **Remind user** — Thesis tables exported to `data/thesis_tables/`. Use `thesis-writer` agent to draft the evaluation chapter.

## Note
Only run this when all 10 prompts are complete, OR for partial evaluation of completed prompts.
