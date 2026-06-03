# P11 — Pipeline Diagnostics & Instrumentation Report

> Branch: `p11-diagnostics` · Date: 2026-06-03 · Scope: **instrumentation only, no behaviour changed**

This report is the deliverable of P11. It is written against **real harness output**
(`tests/test_exercise_dispatch.py`, 22 tests) plus a local micro-benchmark of the
CPU-only stages. The headline finding is concrete enough to write P12 and P13 against:

> **The live "reps stuck at 0" and "most exercises silently broken" symptoms share a
> single root cause: a confidence-gate mismatch.** YOLO runs at `conf=0.10`
> (`app/inference/runner.py`) but `compute_angles` discards any joint below
> `CONF_THRESHOLD = 0.5` (`app/analysis/keypoint_utils.py`). Webcam keypoints routinely
> land in the 0.10–0.50 band, so their joint angles become `None`, which simultaneously
> (a) starves the rep counter of any angle to cross a threshold and (b) trips the form
> scorer's silent `score=0.0` default. **Neither the scoring math nor the rep logic is
> broken** — both are correct under full-confidence input.

---

## 1. Latency breakdown (per stage)

Scalar stages are **measured** locally (2,000 iterations, squat pose, Python 3.11, this
machine). Decode + inference are **not** reproducible here without the model/webcam; the
figures below are the known YOLO26n CPU benchmark and the previously-measured end-to-end
p95. **Exact live mean/p95 per stage are now emitted by the new `ws_pipeline_timing` log
(every 30 frames, labelled by exercise) and the `posecoach_pipeline_stage_latency_seconds`
Prometheus histogram** — read those off the next real gym session.

| Stage | mean | p95 | Source | Notes |
|---|---|---|---|---|
| `frame_decode` | ~3–8 ms | ~10 ms | est. (JPEG decode + resize→640) | now timed live (`decode_ms`) |
| `inference` | ~40 ms | ~57 ms | YOLO26n CPU bench / measured e2e p95 | **dominant cost** |
| `keypoint_smooth` | 0.003 ms | 0.003 ms | measured | EMA, negligible |
| `scoring` | 0.093 ms | 0.106 ms | measured | incl. one `compute_angles` |
| `rep_count` | 0.079 ms | 0.087 ms | measured | incl. a 2nd `compute_angles` |
| `score_smooth` | 0.0005 ms | 0.0006 ms | measured | EMA, negligible |
| `serialize_send` | 0.022 ms | 0.027 ms | measured (`json.dumps` only) | socket write adds event-loop time, captured live |
| **total_loop** | **~45–55 ms** | **~67 ms** | — | matches CLAUDE.local p95 57.2 ms |

**Conclusion for P15:** the entire scalar pipeline (smooth + score + rep + serialize) is
**< 0.2 ms** combined. Inference (~40 ms) and decode dominate. **Latency reduction must
target inference/decode** (imgsz, ONNX vs `.pt`, adaptive client FPS) — optimising the
scoring code would be wasted effort. A secondary, free win already in place: the
single-slot last-write-wins frame buffer drops stale frames so a slow pass can't build a
backlog. One redundancy worth noting: `compute_angles` runs **twice per frame** (once
inside `score_exercise`, once for the rep counter) — a cheap P15 cleanup, not a bug.

---

## 2. Rep counter state diagnosis

**Plumbing is correct — this is _not_ a missing-field bug:**

| Check | Result | Evidence |
|---|---|---|
| `reps` present in the JSON sent to client | ✅ Yes | `ws_response_schema` log (`has_reps_field=true`); `ws_inference.py` response dict |
| One `RepCounter` instance per connection | ✅ Yes | created once (`ws_inference.py:110`), persisted across frames |
| Buffer/state persists across frames | ✅ Yes | hysteresis state machine holds `_state`/`_count` between `update()` calls |
| `.reset()` only on disconnect / exercise change | ✅ Yes | reset on exercise change (`ws_inference.py:239`); never per-frame |
| Counts reps under clean input | ✅ Yes | harness Stage 3 — all 6 dynamic exercises count |

> ⚠️ **Roadmap mismatch (resolved):** the roadmap/​`dataset-training.md` describe the rep
> counter as `scipy.signal.find_peaks` over an `angle_history` buffer. The **actual**
> `rep_counter.py` is a streaming **hysteresis state machine** — no scipy, no buffer, no
> peaks. A useful consequence: it is **FPS-independent** (no `distance`/`prominence`
> tuned to 50 FPS), so the roadmap's "live 15 FPS ≠ eval 50 FPS recalibration" concern
> **does not apply** to this implementation. One less thing for P12 to do.

**Root cause of "stuck at 0" live:** every tracked rep joint arrives as `None` because its
keypoint confidence is below the 0.5 gate, even though the model detected a person at
`conf=0.10`. `RepCounter.update` holds state when it sees no valid angle, so no
flex→extend cycle ever fires. Reproduced deterministically by
`test_low_confidence_reproduces_live_failure`. The new **`ws_rep_audit`** log surfaces this
live: watch `valid_angle_count` — if it reads `0` (or `< tracked_joints`) on frames where
`count` doesn't advance, the conf gate is confirmed as the culprit.

---

## 3. Per-exercise pass/fail (harness, full confidence)

`pytest tests/test_exercise_dispatch.py -v` — **22/22 passed.**

| Exercise | Non-default score | Cue on bad form | Rep count | Verdict |
|---|---|---|---|---|
| squat | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| deadlift | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| curl | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| bench | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| ohp | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| lunge | ✅ | ✅ | ✅ reps > 0 | **PASS** |
| plank | ✅ | ✅ | ✅ reps == 0 (isometric) | **PASS** |

**Interpretation:** the per-exercise *logic* (angle triplets, ANGLE_RANGES, cue templates,
hysteresis thresholds) is sound for all 7. The harness runs at `conf=1.0`, so it
deliberately isolates logic-correctness from the live confidence problem. The fact that
**everything passes here while the app fails in the gym is itself the diagnosis**: the bug
lives in the live low-confidence path, not in the scoring/rep modules.

**Silent-default observation (for P13):** `score_exercise` returns
`FormResult(score=0.0, cues=["Position yourself in frame"])` whenever `joint_scores` is
empty (`form_scorer.py:256`). This is a *silent* fallback — a real "I can't see you"
condition is encoded as a `0.0` score, indistinguishable from genuinely awful form. The
`_NO_PERSON_RESPONSE` path also omits `reps`/`joint_scores`/`rep_state` entirely, so the
client must treat missing fields as "no person."

---

## 4. Recommended fix order

Both P0 tickets share the **same root cause**, so fix it once, shared, then split:

### Shared prerequisite (do first)
- **Resolve the confidence-gate mismatch.** Options, cheapest first:
  1. Introduce a separate, lower **angle-confidence threshold** (e.g. ~0.25) for
     `compute_angles`, decoupled from the 0.5 form gate, so live webcam joints aren't
     discarded. *(Recommended — least disruptive.)*
  2. Or raise the predict `conf` and/or recalibrate the 0.5 gate against real webcam
     confidence histograms (capture via the new audit logs first).
- Land a regression test feeding **mid-confidence (~0.3)** keypoints that asserts reps
  advance and score is non-default — it would have caught this.

### P12 — rep counter (live)
1. Apply the shared conf-gate fix (the actual unblocker).
2. **No FPS recalibration needed** — the hysteresis counter is FPS-independent. Just
   verify `_HYSTERESIS = 0.30` thresholds against real per-exercise angle ranges using the
   `ws_rep_audit` `down_thr`/`up_thr` + live angle values.
3. Confirm `reps` keeps advancing across brief no-person flaps (server count already
   persists; consider keeping the field in `_NO_PERSON_RESPONSE` so the UI doesn't blank).
4. Add the mid-confidence streaming regression test.

### P13 — silently-broken scoring
1. Benefits directly from the shared conf-gate fix.
2. **Kill the silent default:** replace `FormResult(score=0.0, …)` with either a raise or
   an explicit status (e.g. `insufficient_confidence` / `no_person`) distinct from a real
   low score, per the roadmap's "no silent defaults" principle.
3. Keep `tests/test_exercise_dispatch.py` as the CI gate; extend it with mid-confidence
   and partial-occlusion cases (and flip to strict asserts once the defaults are gone).

---

## 5. What P11 added (instrumentation inventory)

- `app/inference/runner.py` — `InferenceOutcome` dataclass carrying `decode_ms` /
  `predict_ms` split (was a bare 3-tuple).
- `app/api/v1/ws_inference.py` — per-stage timing for all 8 stages; `ws_pipeline_timing`
  (mean+p95, every 30 frames); one-shot `ws_response_schema` log; `ws_rep_audit` with
  `valid_angle_count` / thresholds / `rep_counter_id`.
- `app/monitoring/metrics.py` — `posecoach_pipeline_stage_latency_seconds` histogram
  `(stage, exercise)`, on the existing registry.
- `app/analysis/rep_counter.py` — read-only `down_thr` / `up_thr` / `tracked_joints`
  accessors for the audit.
- `tests/test_exercise_dispatch.py` — 22-test synthetic harness incl. the live-failure
  reproduction.

**Privacy:** no frame bytes or raw keypoint arrays are logged — only shapes, millisecond
timings, joint counts, and response *key names*.

**Gates:** `ruff check` ✅ · `ruff format` ✅ · `mypy app/ --strict` ✅ (40 files) ·
`pytest -x` ✅ (296 passed) · `tests/test_exercise_dispatch.py -v` ✅ (22 passed).
