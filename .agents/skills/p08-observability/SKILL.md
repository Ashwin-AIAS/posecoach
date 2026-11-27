---
name: p08-observability
description: PoseCoach P08 — Prometheus metrics, structured logging, and Grafana dashboard. Auto-invoked when working on monitoring, metrics, logging, Prometheus, Grafana, or alerting.
---

# P08 — Observability

## Goal
Extend observability with a Grafana dashboard and richer Prometheus metrics. Most of the logging/metrics infrastructure already exists from P02 — P08 is about dashboards and coverage, not starting from scratch.

## Logging Rules (already enforced — reminder only)
- Always `structlog.get_logger(__name__)` — never `print()` or `logging.getLogger()`
- Never log: frames, raw keypoint arrays, passwords, JWT tokens

## Done Criteria
- [ ] Prometheus scraping `/metrics` endpoint
- [ ] All 5 Grafana panels populated during a test session
- [ ] Inference latency histogram showing correct buckets
- [ ] Chatbot model routing visible in dashboard
- [ ] `pytest tests/test_metrics.py` green
- [ ] No `print()` statements anywhere in `app/` (`ruff check app/` clean)
