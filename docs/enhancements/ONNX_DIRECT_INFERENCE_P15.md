# P15 — Direct ONNX Runtime Inference Path

> **Feed this file to Claude Code as the spec for the next change.**
> Execute the stages **in order**. Do not skip the validation stage.

---

## 1. Goal (one sentence)

Replace the PyTorch-on-CPU inference path with a **direct ONNX Runtime session that
decodes keypoints ourselves**, exported at `imgsz=320`, to cut production
inference latency from ~283 ms median to a target **< 40 ms median** on the
HF/Render free-tier CPU — while producing keypoints identical to the `.pt` model.

**Success = faster inference AND keypoints that match the `.pt` model within ~2 px.**

---

## 2. Why (root cause — read before coding)

Two problems that look separate are the **same root cause**: we rely on
Ultralytics' `model.predict()` wrapper.

1. **"ONNX shows no keypoints" bug.** Ultralytics 8.4.x has an `InferenceSession`
   bug — after the first `predict()`, `results[0].keypoints` returns `None` on
   ONNX models. `main.py` currently *works around* this by silently loading the
   `.pt` model instead of the `.onnx` (see `lifespan`, lines ~85–92). That keeps
   keypoints working but forces us onto slow PyTorch.
2. **Latency wall.** Server-side timing shows inference is **~95% of the server
   loop** (PT@320 ≈ 283 ms median, 590 ms p95). Decode/score/network are noise.
   PyTorch-on-CPU is the bottleneck; ONNX Runtime CPU is far faster.

**The fix for both:** drive ONNX Runtime directly and decode the raw output
tensor ourselves, bypassing the broken wrapper entirely. This restores keypoints
on ONNX *and* unlocks the speedup.

Concurrency (2-in-flight frames) will NOT help — we are CPU-bound on 2 vCPUs, so
parallel predicts just contend. Do not pursue that.

---

## 3. Scope

**In scope**
- New module `app/inference/onnx_session.py` — direct ONNX Runtime wrapper + keypoint decode.
- Re-export the ONNX model at `imgsz=320` (Colab — see Stage A).
- Wire the new path into `main.py` lifespan + `app/inference/runner.py`.
- Remove the double-resize waste in `_decode_frame` (decode straight to 320).
- Parity + latency validation.

**Out of scope** — do NOT touch these:
- Scoring, smoothing, rep-counter logic (they consume `kp_xyn (17,2)` + `kp_conf (17,)` — keep that contract identical).
- The interpolation / frontend stream code (it stays — it hides round-trip gaps).
- WebSocket backpressure / 2-in-flight concurrency.

---

## 4. Hard rules (from project memory — do not violate)

- **NMS-free.** Never call any NMS function after inference. YOLO26 one-to-one head handles it.
- **Never pass `end2end=False`** anywhere. It silently switches to the NMS head and breaks parsing.
- Output contract stays: `kp_xyn` shape `(17, 2)` **normalized [0,1]**, `kp_conf` shape `(17,)`.
- Confidence gate stays downstream: joints with `conf < 0.5` are skipped (do not change in this module).
- **structlog only** — `logger = structlog.get_logger(__name__)`. Never `print()` / `logging.getLogger()`.
- Absolute imports, full type hints (`mypy --strict`), no bare `except`, Google-style docstrings.
- Model loaded **once** in lifespan → `app.state.model`. Never per-request.
- Predict runs in the executor, never on the async loop (already the case in `runner.py`).
- This repo lives in **OneDrive** — Edit/Write tools truncate files. Write/patch via **bash heredoc** and verify with `wc -l` + `python -c "import ast; ast.parse(open(...).read())"`.

---

## 5. Implementation stages

### Stage A — Re-export ONNX at imgsz=320 (Colab ONLY)

Training/export happens on Colab per project rules (RTX 3050 4 GB OOMs locally;
export must be reproducible). In the P01 Colab notebook, from the finetuned best `.pt`:

```python
from ultralytics import YOLO
model = YOLO("yolo_posecoach_v1.pt", task="pose")
model.fuse()  # MUST run before export — merges Conv+BN, removes auxiliary head
model.export(
    format="onnx",
    imgsz=320,        # <-- key change: 320 not 640 (~4x less compute on CPU)
    simplify=True,
    opset=17,
    dynamic=False,    # static shape = fastest CPU inference
)
# Do NOT pass end2end=False — keep the one-to-one (NMS-free) head.
```

Save as `models/yolo_posecoach_v1_320.onnx` in Drive, then sync to local
`posecoach/models/` (Git LFS on Windows). **Note:** the current
`models/yolo_posecoach_v1.onnx` is a 640 export and is only a 12 MB LFS pointer
locally — do not assume it is loadable until pulled.

> If Colab is not available right now, Claude Code can still build & unit-test
> Stage B against a locally re-exported 320 model produced with the same snippet
> (CPU export of an already-trained `.pt` is fine; only *training* needs GPU).

---

### Stage B — New module: `app/inference/onnx_session.py`

Create a small class that owns the ONNX Runtime session and does its own decode.

**Critical: discover the output tensor layout at load time — do NOT hardcode it.**
YOLO26-pose ONNX output is non-obvious. On init, log
`session.get_inputs()` and `session.get_outputs()` shapes, then write the decode
around what is actually observed. Build it incrementally and confirm against the
`.pt` model in Stage D.

Required surface:

```python
class OnnxPoseSession:
    """Direct ONNX Runtime pose inference, bypassing Ultralytics' predict wrapper.

    Loads a static-shape YOLO26-pose ONNX (one-to-one / NMS-free head) and decodes
    the raw output tensor into normalized keypoints, matching the contract that
    app.inference.runner and the form scorer expect.
    """

    def __init__(self, model_path: str, imgsz: int = 320) -> None: ...

    def predict(self, frame_rgb_uint8) -> tuple[NDArray, NDArray] | None:
        """Run one frame.

        Args:
            frame_rgb_uint8: (imgsz, imgsz, 3) uint8 RGB, already resized.
        Returns:
            (kp_xyn, kp_conf) where kp_xyn is (17, 2) normalized [0,1] and
            kp_conf is (17,), for the highest-confidence person; or None if no
            person is detected.
        """
```

Implementation notes:
- Providers: `["CPUExecutionProvider"]`. Set
  `sess_options.intra_op_num_threads` to the vCPU count (2 on free tier) — measure both 1 and 2.
- **Preprocess** inside `predict`: `frame` is `(H,W,3)` uint8 RGB → `float32 / 255.0`
  → transpose to `(1, 3, imgsz, imgsz)` (NCHW), contiguous. (No letterbox needed
  since the frame is already a square resize — but record this assumption; if
  parity is off, switch to letterbox + scale-back.)
- **Decode**: parse the output into per-person `(box_conf, 17×(x,y,kp_conf))`.
  Pick the person with the highest detection confidence. Convert pixel coords to
  **normalized** by dividing x,y by `imgsz`. Return `(17,2)` and `(17,)`.
- Reference for the session-creation pattern: `scripts/eval_latency.py` already
  builds an `ort.InferenceSession` — reuse the provider/options approach, but that
  script only benchmarks random input; it does NOT decode, so the decode is new.
- No NMS. The one-to-one head returns up to 300 already-filtered detections;
  threshold on detection conf (reuse the existing `conf=0.10` value from `runner.py`).
- structlog: `logger.info("onnx_session_loaded", imgsz=imgsz, outputs=[...])` and
  `logger.debug("onnx_decoded", n_persons=..., top_conf=...)`. Never log raw tensors/frames.

Add `onnxruntime` to `requirements.txt` (it is imported in `eval_latency.py` but
NOT in requirements — add a pinned version, CPU build).

---

### Stage C — Wire it in (`main.py` + `runner.py`)

**`app/main.py` lifespan:** when `MODEL_PATH` ends in `.onnx`, build an
`OnnxPoseSession` instead of falling back to the `.pt`. Remove (or gate behind an
env flag) the current "prefer .pt over .onnx" workaround at lines ~85–92, since
the whole point is to use ONNX now. Keep `.pt` loading as the path when
`MODEL_PATH` ends in `.pt` (dev/local convenience). Store on
`application.state.model` exactly as today so nothing downstream changes shape.

**`app/inference/runner.py`:**
- In `_predict`, branch on session type: if it is an `OnnxPoseSession`, call our
  `.predict(frame)` and return `(kp_xyn, kp_conf)` directly; if it is a YOLO `.pt`
  model, keep the existing `model.predict(...)` path. Remove the brittle
  `getattr(model, "path", "")` `.onnx` sniffing.
- **Decode-to-320 fix:** change `_INFERENCE_SIZE` handling so the frame is decoded
  **straight to the model's input size** (320 for ONNX) instead of decoding to 640
  then letting YOLO downscale to 320. This kills the decode-p95≈78 ms double-resize
  waste. Make the size come from the loaded session, not a hardcoded 640.
- Keep the `InferenceOutcome` dataclass and the `decode_ms` / `predict_ms` /
  `latency_ms` timing split intact — we want to re-measure after the change.

---

### Stage D — Validation (DO NOT SKIP)

1. **Parity test (most important).** New `tests/test_onnx_parity.py`:
   take 5–10 real-ish frames (or a saved fixture), run them through BOTH the `.pt`
   YOLO model and `OnnxPoseSession`, assert the 17 keypoints agree within a small
   tolerance (e.g. **mean abs diff < 0.01 normalized**, ~2–3 px at 320). If they
   diverge, the decode/preprocess is wrong — fix before trusting the path.
   (Tests use SQLite in-memory conventions where DB is needed; this one is pure
   inference, no DB.)
2. **No-person case** returns `None` cleanly (feed a blank frame).
3. **Latency re-measure.** Re-run the production timing (or `scripts/eval_latency.py`
   live path against the 320 ONNX) and record median / p95. Target: median < 40 ms,
   p95 well under 100 ms.
4. **Quality gate** (from `.claude/rules/code-style.md`):
   ```bash
   ruff check app/ --fix
   mypy app/ --strict
   pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
   ```
   All three must pass.
5. Manual smoke: run the server with `MODEL_PATH=models/yolo_posecoach_v1_320.onnx`,
   open the live page, confirm the skeleton renders (keypoints present) and the
   stream is visibly snappier.

---

## 6. Acceptance criteria

- [ ] `OnnxPoseSession` returns `(17,2)` normalized kp + `(17,)` conf, parity with `.pt` within tolerance.
- [ ] Keypoints render live when `MODEL_PATH` points at the 320 ONNX (no more silent `.pt` fallback).
- [ ] Decode no longer double-resizes (decode straight to model input size).
- [ ] Median inference < 40 ms on free-tier CPU (down from ~283 ms); p95 < 100 ms.
- [ ] `onnxruntime` pinned in `requirements.txt`.
- [ ] ruff + mypy --strict + pytest (cov ≥ 80% on app/analysis) all pass.
- [ ] No `end2end=False`, no NMS call, structlog throughout, no frames/keypoints logged.

---

## 7. Risk / fallback

- **If parity fails** (keypoints off): the cause is almost always preprocess —
  most likely a letterbox/aspect-ratio or normalization mismatch, or a transposed
  output axis. Log the raw output shape, decode one frame by hand, compare against
  the `.pt` raw output. Switch the square-resize assumption to proper letterbox +
  coordinate scale-back if needed.
- **If ONNX export can't happen yet:** Stage B + its parity test can be developed
  against a locally CPU-exported 320 model; only Colab is needed for the canonical
  artifact that ships.
- Keep the `.pt` path working as a fallback (env-selectable via `MODEL_PATH`) so a
  bad ONNX never takes the service down.

---

## 8. Commit format (per `.claude/rules/code-style.md`)

```
[P15] feat: direct ONNX Runtime inference path (imgsz=320)

- add app/inference/onnx_session.py with own keypoint decode
- wire ONNX path into lifespan + runner, drop .pt fallback workaround
- decode straight to model input size (kill double-resize)
- add onnx parity + latency tests; pin onnxruntime
```
