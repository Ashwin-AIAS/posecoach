from typing import Any

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, make_asgi_app

registry = CollectorRegistry()

http_requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status_code"],
    registry=registry,
)

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
    registry=registry,
)

inference_latency_seconds = Histogram(
    "inference_latency_seconds",
    "YOLO26 inference latency per frame",
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
    registry=registry,
)

form_score_events_total = Counter(
    "form_score_events_total",
    "Form scoring events by exercise and grade",
    ["exercise", "grade"],
    registry=registry,
)

# Distribution of form scores (0–100) per exercise — used for the Grafana heatmap.
form_score = Histogram(
    "posecoach_form_score",
    "Distribution of per-frame form scores by exercise",
    ["exercise"],
    buckets=[10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    registry=registry,
)

active_ws_connections = Gauge(
    "ws_connections_active",
    "Currently active WebSocket connections",
    registry=registry,
)

chat_requests_total = Counter(
    "chat_requests_total",
    "RAG chatbot requests by provider",
    ["provider"],
    registry=registry,
)


def get_metrics_app() -> Any:
    """Returns ASGI app for /metrics — mount only when METRICS_TOKEN is set."""
    return make_asgi_app(registry=registry)
