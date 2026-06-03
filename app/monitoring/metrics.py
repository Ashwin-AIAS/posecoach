"""P11 pipeline-stage instrumentation metrics.

These histograms time each stage of the live WebSocket inference loop, labelled
by stage and exercise, so the Grafana board can break down where per-frame
latency is spent. They register on the SAME ``CollectorRegistry`` as
``app.metrics`` so the existing ``/metrics`` scrape endpoint exports them with
no extra wiring.

Instrumentation only — observing these never changes inference behaviour.
"""

from __future__ import annotations

from prometheus_client import Histogram

from app.metrics import registry

# Named stages of the per-frame inference loop. Kept as a module-level constant
# so the WS handler and any dashboards reference the same canonical labels.
PIPELINE_STAGES: tuple[str, ...] = (
    "frame_decode",
    "inference",
    "keypoint_smooth",
    "scoring",
    "rep_count",
    "score_smooth",
    "serialize_send",
    "total_loop",
)

# One histogram, labelled by (stage, exercise). Buckets span sub-millisecond to
# ~half a second to capture both the fast scalar stages and slow CPU inference.
pipeline_stage_latency_seconds = Histogram(
    "posecoach_pipeline_stage_latency_seconds",
    "Per-frame WebSocket inference pipeline latency, by stage and exercise",
    ["stage", "exercise"],
    buckets=[0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
    registry=registry,
)
