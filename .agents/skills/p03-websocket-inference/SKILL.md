---
name: p03-websocket-inference
description: PoseCoach P03 — WebSocket endpoint + real-time YOLO26 inference pipeline. Auto-invoked when working on WebSocket, pose inference, frame processing, keypoint extraction, or form scoring. Knows dual-head architecture, correct result parsing, and executor pattern.
---

# P03 — WebSocket + Real-Time Inference Pipeline

## Goal
Build a FastAPI WebSocket endpoint that receives video frames from the browser, runs YOLO26-pose inference (one-to-one head, NMS-free), applies EMA keypoint smoothing, computes form scores, and streams results back — all under 100ms per frame end-to-end.

## Key Files
- `app/api/v1/ws_inference.py` — WebSocket route
- `app/inference/runner.py` — async inference wrapper (executor pattern)
- `app/inference/smoother.py` — EMA keypoint smoother (α=0.6)
- `app/analysis/form_scorer.py` — joint angle computation + exercise scoring
- `app/analysis/score_smoother.py` — EMA smoother for form score output (α=0.6)
- `app/analysis/keypoint_utils.py` — keypoint helpers, angle utils
- `app/analysis/angle_ranges.json` — ANGLE_RANGES per exercise (from Fit3D)

## YOLO26 Dual-Head — Use Default (One-to-One)
YOLO26 has two heads. **Always use the default one-to-one head** (NMS-free):
```python
# CORRECT — one-to-one head (default, NMS-free)
results = model.predict(frame, verbose=False)

# WRONG — switches to one-to-many head (requires NMS, breaks everything)
results = model.predict(frame, verbose=False, end2end=False)  # NEVER DO THIS
```

## Inference Pattern (Exact — Must Follow)
```python
loop = asyncio.get_event_loop()
results = await loop.run_in_executor(
    app.state.executor,
    lambda: app.state.model.predict(frame, verbose=False)
    # No end2end=False — use default one-to-one head
)

# Parse keypoints — shape (num_persons, 17, 2) normalized
keypoints_xyn = results[0].keypoints.xyn.cpu().numpy()   # coords
keypoints_conf = results[0].keypoints.conf.cpu().numpy() # confidence
```

## Form Scorer
- 7 exercises: `squat, deadlift, curl, bench, ohp, lunge, plank`
- Angle ranges from `app/analysis/angle_ranges.json` (exported from Fit3D golden templates)
- Loaded as `ANGLE_RANGES` dict in `form_scorer.py` — never inline magic numbers
- Confidence gate: skip joint if `kp_conf[joint_idx] < 0.5`
- Score 0–100: % of joints within correct angle range
- Cues: max 8 words each, plain English

## Done Criteria
- [ ] WebSocket at `ws://localhost:8000/ws/inference`
- [ ] `app/inference/smoother.py` with `KeypointSmoother(alpha=0.6)` — one per connection
- [ ] `app/analysis/score_smoother.py` with `ScoreSmoother(alpha=0.6)`
- [ ] Inference < 100ms p95 on CPU (measured by `eval_latency.py`)
- [ ] All 7 exercises score correctly (test with synthetic keypoints)
- [ ] `end2end=False` absent from all inference code (code-reviewer check)
- [ ] No raw frames stored anywhere
