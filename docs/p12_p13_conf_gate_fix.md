# P12 + P13 — Confidence-Gate Fix (rep counter + silent-default scoring)

> Branch: `p12-p13-conf-gate-fix` · Implements the shared fix the P11 diagnostics
> (`docs/p11_diagnostics.md`) identified, then the two tickets stacked on it.
> **App behaviour changes here** (unlike P11, which was instrumentation only).

## Root cause (from P11)

YOLO predicts at `conf=0.10` (`app/inference/runner.py`) but `compute_angles`
discarded any joint below a hard `0.5` gate. Real webcam keypoints routinely land
in the **0.10–0.50 band**, so their angles became `None`, which simultaneously
(a) starved the rep counter (no angle to cross a threshold → reps stuck at 0) and
(b) tripped the form scorer's silent `score=0.0` default (read as "terrible form").

## What changed

### Shared prerequisite — the gate
- `app/analysis/keypoint_utils.py`: `CONF_THRESHOLD = 0.5` → **`ANGLE_CONF_THRESHOLD`**,
  read from the `ANGLE_CONF_THRESHOLD` env var, **default `0.25`**. It is now the
  default for `compute_angles` and `score_exercise`.
- `.env.example`: documents `ANGLE_CONF_THRESHOLD=0.25`.

> ⚠️ **`0.25` is provisional.** It is the interim value from
> `docs/p11_calibration_session.md`, not a measured one. After an in-gym capture
> session, run `scripts/analyze_conf_distribution.py` and replace it (env var, no
> code change) with the measured percentile, citing
> `data/eval/conf_distribution_summary.json`.

### P13 — no more silent `score=0.0`
- `FormResult` gains a **`status`** field: `ok` | `insufficient_confidence` |
  `unknown_exercise` (`STATUS_*` constants in `app/analysis/form_scorer.py`).
  `score` is only meaningful when `status == "ok"`.
- The "no joint cleared the gate" path now returns `insufficient_confidence`
  instead of a fake `0.0`.

### P13 — WS contract
- `app/api/v1/ws_inference.py` now emits **`status`** on every message:
  - normal frame → `status: "ok"` (unchanged score/cues/etc.)
  - person visible but unscorable → `status: "insufficient_confidence"`, **`score: null`**,
    cues + reps preserved. The fake `0.0` is **not** fed into the score smoother,
    Prometheus `form_score`, or the session average — so metrics stay honest.
  - no person → `status: "no_person"` (was already `score: null`).

### P12 — rep counter
- The gate fix is the actual unblocker: mid-band joints now yield angles, so the
  (FPS-independent) hysteresis counter sees flex→extend cycles again.
- The no-person frame now carries the running **`reps`** count so a brief dropout
  doesn't blank the on-screen counter.

### Frontend
- `frontend/src/types.ts`: `PoseStatus` + optional `status` on `PoseResult`
  (absent ⇒ treated as `ok`, backward-compatible with older servers).
- `frontend/src/components/CameraHud.tsx`: when `status !== "ok"`, a centered
  **status banner** ("Step into frame" / "Hold still — adjusting to you") replaces
  the coaching caption and worst-joint chip, so a "can't see you" frame never
  reads as a form correction. The score ring already shows `—` for a null score.

## Regression guards
- `tests/test_exercise_dispatch.py::test_mid_confidence_advances_reps_and_scores`
  — feeds 0.35-confidence keypoints (the webcam band) and asserts reps advance and
  frames score (`status == ok`). This would have caught the original bug.
- `test_low_confidence_reproduces_live_failure` retargeted to assert
  `insufficient_confidence` (0.2 conf stays below the 0.25 gate).
- `tests/test_form_scorer.py`, `tests/test_keypoint_confidence.py` updated from
  the old `score == 0.0` / `0.5`-boundary assertions to the new status + gate.

## Still pending (needs the gym)
The `0.25` default is a guess until the calibration session is run. Validate live
per `docs/next_session.md`, capture the distribution, then tune the env var.
