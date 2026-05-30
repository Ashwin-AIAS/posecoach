---
name: p03-websocket-inference
description: PoseCoach P03 — WebSocket endpoint + real-time YOLO26 inference pipeline. Auto-invoked when working on WebSocket, pose inference, frame processing, keypoint extraction, or form scoring. Knows dual-head architecture, correct result parsing, and executor pattern.
allowed-tools: Read, Write, Edit, Bash
---

# P03 — WebSocket + Real-Time Inference Pipeline

## Goal
Build a FastAPI WebSocket endpoint that receives video frames from the browser, runs YOLO26-pose inference (one-to-one head, NMS-free), applies EMA keypoint smoothing, computes form scores, and streams results back — all under 100ms per frame end-to-end.

## Key Files (all to be created in P03)
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

# Take first detected person
if keypoints_xyn.shape[0] == 0:
    continue  # no person detected
kp = keypoints_xyn[0]    # shape (17, 2)
kp_conf = keypoints_conf[0]  # shape (17,)
```

## EMA Keypoint Smoother (app/inference/smoother.py)
Raw YOLO keypoints jitter frame-to-frame. Apply EMA smoothing before scoring:
```python
class KeypointSmoother:
    """Exponential Moving Average smoother for YOLO keypoints.
    
    Args:
        alpha: Smoothing factor. 0.6 = standard; lower = smoother but more lag.
    """
    def __init__(self, alpha: float = 0.6) -> None:
        self.alpha = alpha
        self._prev: np.ndarray | None = None

    def update(self, kp: np.ndarray) -> np.ndarray:
        """Smooth keypoints array of shape (17, 2)."""
        if self._prev is None:
            self._prev = kp.copy()
            return kp
        smoothed = self.alpha * kp + (1 - self.alpha) * self._prev
        self._prev = smoothed
        return smoothed

    def reset(self) -> None:
        """Call on WebSocket connect/disconnect."""
        self._prev = None
```
- One `KeypointSmoother` instance per WebSocket connection (not global)
- Call `smoother.reset()` on disconnect

## Score Smoother (app/analysis/score_smoother.py)
Form score also needs smoothing to prevent flickering UI:
```python
class ScoreSmoother:
    """EMA smoother for scalar form score."""
    def __init__(self, alpha: float = 0.6) -> None:
        self.alpha = alpha
        self._prev: float | None = None

    def update(self, score: float) -> float:
        if self._prev is None:
            self._prev = score
            return score
        smoothed = self.alpha * score + (1 - self.alpha) * self._prev
        self._prev = smoothed
        return smoothed

    def reset(self) -> None:
        self._prev = None
```

## WebSocket Protocol
**Client → Server** (JSON):
```json
{"frame": "<base64 JPEG>", "exercise": "squat"}
```
**Server → Client** (JSON):
```json
{
  "keypoints": [[x,y], ...],
  "confidence": [0.9, ...],
  "score": 87.5,
  "cues": ["Drive knees out", "Chest up"],
  "latency_ms": 23.4
}
```

## Form Scorer
- 7 exercises: `squat, deadlift, curl, bench, ohp, lunge, plank`
- Angle ranges from `app/analysis/angle_ranges.json` (exported from Fit3D golden templates)
- Loaded as `ANGLE_RANGES` dict in `form_scorer.py` — never inline magic numbers
- Confidence gate: skip joint if `kp_conf[joint_idx] < 0.5`
- Score 0–100: % of joints within correct angle range
- Cues: max 8 words each, plain English

## ONNX Model for Production
```python
# In app/main.py lifespan
app.state.model = YOLO('models/yolo_posecoach_v1.onnx')  # ONNX, no GPU needed
app.state.executor = ThreadPoolExecutor(max_workers=2)
```
ONNX was exported with `model.fuse()` first — auxiliary head already removed.

## Latency Budget (CPU ONNX)
| Component | Time |
|-----------|------|
| YOLO26n inference | ~40ms |
| Preprocessing (decode + resize) | ~5ms |
| EMA smoothing | ~0.5ms |
| Angle computation | ~2ms |
| WebSocket round-trip | ~10ms |
| **Total target** | **< 100ms** |

## Done Criteria
- [ ] WebSocket at `ws://localhost:8000/ws/inference`
- [ ] `app/inference/smoother.py` with `KeypointSmoother(alpha=0.6)` — one per connection
- [ ] `app/analysis/score_smoother.py` with `ScoreSmoother(alpha=0.6)`
- [ ] Inference < 100ms p95 on CPU (measured by `eval_latency.py`)
- [ ] All 7 exercises score correctly (test with synthetic keypoints)
- [ ] `end2end=False` absent from all inference code (code-reviewer check)
- [ ] `pytest tests/test_inference.py tests/test_form_scorer.py tests/test_smoother.py` green
- [ ] No raw frames stored anywhere

## Thesis Metrics
- Inference latency p50/p95/p99 (target p95 < 100ms)
- Form scoring accuracy vs. Fit3D expert annotations (target > 85% agreement)
- Form score temporal consistency (smoother reduces variance)
