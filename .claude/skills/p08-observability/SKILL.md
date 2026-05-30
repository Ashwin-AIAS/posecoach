---
name: p08-observability
description: PoseCoach P08 — Prometheus metrics, structured logging, and Grafana dashboard. Auto-invoked when working on monitoring, metrics, logging, Prometheus, Grafana, or alerting.
allowed-tools: Read, Write, Edit, Bash
---

# P08 — Observability

## Goal
Extend observability with a Grafana dashboard and richer Prometheus metrics. Most of the
logging/metrics infrastructure already exists from P02 — P08 is about dashboards and
coverage, not starting from scratch.

## What Already Exists (P02 deliverables — do NOT recreate)
- `app/core/logging_config.py` — structlog JSON setup, already active
- `app/monitoring/metrics.py` — base Prometheus metrics already defined
- `app/middleware/` — request timing, security headers, cache middleware all exist
- `app/main.py` — `/metrics` endpoint already wired up via prometheus_fastapi_instrumentator

## What P08 Adds
- Additional business metrics (form scores per exercise, chatbot routing decisions)
- `deploy/prometheus/prometheus.yml` — Prometheus scrape config for the project
- `deploy/grafana/dashboards/posecoach.json` — Grafana dashboard JSON export
- `docker-compose.yml` additions: prometheus + grafana services
- Tests in `tests/test_metrics.py`

## Metrics to Add (in app/monitoring/metrics.py)
```python
# These may not exist yet — check before adding
form_scores = Histogram(
    "posecoach_form_score",
    "Distribution of form scores by exercise",
    labelnames=["exercise"]
)
chatbot_requests = Counter(
    "posecoach_chatbot_requests_total",
    "Chatbot requests by model",
    labelnames=["model"]  # gemini | qwen
)
ws_connections_active = Gauge(
    "posecoach_ws_connections_active",
    "Active WebSocket connections"
)
```

## Logging Rules (already enforced — reminder only)
- Always `structlog.get_logger(__name__)` — never `print()` or `logging.getLogger()`
- Never log: frames, raw keypoint arrays, passwords, JWT tokens
- Log format is JSON (configured by logging_config.py):
```json
{
  "timestamp": "2026-05-11T10:00:00Z",
  "level": "INFO",
  "logger": "app.inference",
  "message": "inference_complete",
  "latency_ms": 23.4,
  "exercise": "squat"
}
```

## Docker Compose Additions
```yaml
prometheus:
  image: prom/prometheus
  volumes: [./deploy/prometheus:/etc/prometheus]
  ports: ["9090:9090"]

grafana:
  image: grafana/grafana
  ports: ["3001:3000"]
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
```

## Grafana Dashboard Panels
1. Inference latency p50/p95/p99 (histogram)
2. Active WebSocket connections (gauge)
3. Form score distribution by exercise (heatmap)
4. Chatbot requests by model (Gemini vs Qwen)
5. HTTP request rate by endpoint

## Done Criteria
- [ ] Prometheus scraping `/metrics` endpoint (confirm via `http://localhost:9090`)
- [ ] All 5 Grafana panels populated during a test session
- [ ] Inference latency histogram showing correct buckets
- [ ] Chatbot model routing visible in dashboard
- [ ] `pytest tests/test_metrics.py` green
- [ ] No `print()` statements anywhere in `app/` (`ruff check app/` clean)

## Thesis Metric
- Inference latency distribution (from Prometheus data — feeds eval_latency.py)
- System resource usage under concurrent load
