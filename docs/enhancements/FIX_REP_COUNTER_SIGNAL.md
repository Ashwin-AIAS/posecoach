# FIX — Rep Counter Robustness (One-Euro smoothing + adaptive thresholds + dropout bridging)

> Autonomous task brief for Claude Code. Self-contained. Work until **every**
> item in section 8 (Definition of Done) is checked. The rep counter is
> deterministic and thesis-measured — do **not** introduce randomness, break
> existing tests, or add a runtime dependency. Read `app/analysis/rep_counter.py`,
> `app/analysis/score_smoother.py`, `tests/test_rep_counter.py`, and
> `data/eval/rep_counter_validation.json` before writing code.

---

## 1. Problem (observed)

The live rep counter underperforms in the **real world**: the gym-test headline
sat at **0.7102** (`baseline_v5_headline` in `data/eval/rep_counter_validation.json`)
against a **≥ 0.90** thesis gate. Yet the same file shows the counting *logic*
scores `overall_accuracy: 1.0` on clean synthetic reps and `0.9623` at 25 %
frame occlusion. So the gap is **not the counting algorithm** — the per-joint
hysteresis machine is already sound. The gap is the **angle signal feeding it**:

- **Fast reps get missed.** The fixed EMA (alpha=0.6) lags and flattens quick
  peaks; the `_MIN_AMPLITUDE` guard then rejects the flattened rep.
- **Off-axis cameras / different bodies miscount.** Thresholds come from fixed
  Fit3D `[p5, p95]` percentiles; a real user at a tilted camera (2D-projected
  angles) does not match those percentiles, so reps fall outside the band.
- **Perception dropout drops reps.** When a primary keypoint dips below the
  confidence gate mid-rep, the angle is `None`, the frame is skipped, and a
  multi-frame dropout can lose the trough/peak → a missed rep. The eval note
  states plainly: *"the dominant real-world miscount source is perception
  dropout, not counting logic."*

## 2. Root cause (already diagnosed — verify in code, then fix)

In `app/analysis/rep_counter.py`, `_JointRepMachine`:
- Smooths each joint with `ScoreSmoother(_EMA_ALPHA)` where `_EMA_ALPHA = 0.6` —
  a **constant** low-pass. Constant smoothing cannot be both jitter-free when
  still and lag-free when fast; on a fast rep it flattens `_top`/`_trough` so
  `amplitude < self._min_amp` and the rep is rejected.
- Derives `_down`/`_up` **once** from `joint_range(exercise, joint)` (fixed Fit3D
  `[p5, p95]`) via `_HYSTERESIS = 0.30`. There is no adaptation to the user's
  actual ROM or camera angle.
- On `angle is None` the joint's machine is simply **not updated** that frame
  (see `RepCounter.update`). A brief dropout therefore freezes state; a longer
  dropout spanning the trough loses the rep.

## 3. Goal

Lift real-world rep accuracy toward the **≥ 0.90** gate (and raise the
25 %-occlusion figure above its current `0.9623`) **without** regressing the
clean-signal `1.0`, determinism, streaming (one frame at a time), or adding any
pip dependency. Same public `RepCounter` API.

## 4. Recommended approach (three deterministic, streaming pillars)

### A. One-Euro filter (`app/analysis/one_euro.py`, new)
Speed-adaptive low-pass (Casiez, Roussel, Vogel — CHI 2012), implemented
in-house (no dependency). Drop-in replacement for the per-joint `ScoreSmoother`
inside `_JointRepMachine`:
- Public API mirrors `ScoreSmoother`: `update(value: float, dt: float = 1.0) -> float`
  and `reset() -> None`. Default `dt = 1.0` (one frame) keeps it deterministic
  for the existing sequence-only tests.
- Parameters `ONE_EURO_MIN_CUTOFF`, `ONE_EURO_BETA`, `ONE_EURO_D_CUTOFF` as
  module-level UPPER_SNAKE_CASE constants — **no inline magic numbers**.
- Effect: smooths hard when the joint is near-still (kills jitter → fewer false
  threshold crossings), eases off when moving fast (less lag → the amplitude
  guard stops rejecting genuine fast reps).

### B. Adaptive thresholds (in `_JointRepMachine`)
- **Seed** `_down`/`_up` from the Fit3D `joint_range` prior exactly as today, so
  the first rep still counts and existing threshold-dependent tests stay valid.
- After **each completed rep**, update an EMA of the observed `_top` and
  `_trough`, and recentre the dead-band on the user's actual ROM (keep the same
  `_HYSTERESIS` fraction of the *observed* span). Deterministic; no temporal
  randomness.
- **Fallback:** until the first rep completes, behave exactly as the fixed-prior
  version. Adaptation may only *recentre*, never widen past the joint's
  anatomical `[p5, p95]` — clamp to the prior so noise cannot drift the band off
  the body. Derive the adaptation rate as a module constant.

### C. Dropout bridging (in `RepCounter.update` / `_JointRepMachine`)
- When a primary joint angle is `None` for **<= MAX_BRIDGE_FRAMES** consecutive
  frames, hold the last smoothed value (carry-forward) so a brief occlusion mid
  rep does not lose the trough/peak.
- For gaps **longer** than `MAX_BRIDGE_FRAMES`, freeze state as today (do not
  invent motion). `MAX_BRIDGE_FRAMES` is a module constant (~3 frames at 15 fps
  live ≈ 0.2 s). Deterministic.

## 5. Alternative (only if 4B proves unstable)

If adaptive thresholds cannot be made stable/deterministic without breaking the
consistency tests, ship pillars **A + C only** (One-Euro + dropout bridging),
leave thresholds on the fixed Fit3D prior, and record why here. A + C alone
still attack lag and the dominant dropout cause. **Ask Ashwin before dropping
pillar B.**

## 6. Constraints (from project rules — do not violate)

- **Deterministic:** same angle sequence → same count. `test_rep_counter.py`
  asserts this; keep it green.
- **Streaming:** one frame at a time; one filter + one machine instance per
  joint; `RepCounter.reset()` must reset every filter and adaptive-threshold
  state (call on disconnect / exercise change).
- **No inline magic numbers** — all One-Euro params, the bridge length, and the
  adaptation rate are module UPPER_SNAKE_CASE constants. Joint ranges still come
  from `angle_ranges.json` via `joint_range`.
- `ruff check app/ --fix`, `ruff format app/`, `mypy app/ --strict` all pass;
  every function fully typed; Google-style docstrings on public functions; no
  bare `except`; absolute imports only.
- Logging via `structlog.get_logger(__name__)` only — never `print()`.
- Coverage on `app/analysis/` stays **>= 80 %** (`--cov-fail-under=80`).
- **No new pip dependency** — implement One-Euro yourself (it is ~30 lines).
- **This repo lives in OneDrive** — after writing each file verify it is
  non-truncated: `wc -l <file>` and
  `python -c "import ast; ast.parse(open('<file>').read())"`.

## 7. Verification

- `pytest tests/test_rep_counter.py -v` — every existing case stays green
  (full reps, shallow-not-counted, noisy, bottom-bounce, cadence flick,
  occluded-frames-hold, unilateral one-arm row, plank isometric, determinism,
  reset, and both parametrized exercise sweeps).
- **New `tests/test_one_euro.py`:** converges to a constant input; lag on a fast
  ramp is strictly less than the old `ScoreSmoother(0.6)`; deterministic
  (same input → same output); `reset()` clears state.
- **New cases in `tests/test_rep_counter.py`:**
  - a **fast-tempo** rep wave (short `phase`) that the old EMA flattened now
    counts correctly;
  - a **mid-rep dropout** of `<= MAX_BRIDGE_FRAMES` (`None` frames) still counts
    the rep; a dropout **longer** than the bridge does **not** invent a rep;
  - a **reduced-ROM** user (e.g. squats only to ~110 deg) still counts after
    threshold calibration, while a genuine shallow partial (section 1 of the
    existing `test_shallow_reps_not_counted`) still counts **zero**.
- `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80` — passes.
- Re-run `python scripts/eval_rep_counter.py`: clean `overall_accuracy` stays
  `1.0`; `overall_accuracy_25pct_occlusion` **improves** vs `0.9623`; write the
  refreshed `data/eval/rep_counter_validation.json`. Run
  `python scripts/diagnose_rep_counter.py` for the before/after diagnosis.
  (Full 18 GB Fit3D revalidation remains the Colab Step 12 follow-up — note it,
  do not attempt locally.)

## 8. Definition of Done

- [x] `app/analysis/one_euro.py` added: deterministic `OneEuroFilter`, params as
      module constants, `update(value, dt=1.0)` + `reset()` API, fully typed with
      Google-style docstrings.
      - Added a 4th constant beyond the literal 3 named in section 4A:
        `ONE_EURO_MAX_DX` — a hard ceiling on the per-frame velocity fed into
        the cutoff computation. Without it, a single implausible one-frame
        jump (not real motion — see the cadence note below) opens the cutoff
        just as far as genuine sustained fast motion, since both can produce
        the same instantaneous `dx`. `ONE_EURO_D_CUTOFF` was also lowered well
        below the textbook default (0.1 vs. 1.0) so the velocity estimate
        itself only opens up for speed *sustained* over several frames, not a
        single spike. Still deterministic, in-house, no new dependency.
- [x] `_JointRepMachine` uses `OneEuroFilter` instead of the fixed EMA; one
      instance per machine; cleared by `RepCounter.reset()` (which rebuilds a
      fresh `_JointRepMachine`, so every filter/threshold/dropout field resets).
- [x] Adaptive thresholds: seeded from the Fit3D prior, recentred after each rep,
      clamped to `[p5, p95]`, deterministic, with a fixed-prior fallback before
      the first rep. No inline magic numbers (`_THRESHOLD_ADAPT_ALPHA`).
- [x] Dropout bridging: `<= MAX_BRIDGE_FRAMES` holds the last value; longer gaps
      freeze state; deterministic. Implemented as `_JointRepMachine.on_missing()`,
      called from `RepCounter.update()` for any joint whose angle is `None` this
      frame.
- [x] All existing `tests/test_rep_counter.py` pass unchanged. One existing case
      needed re-baselining to keep its *intent* valid:
      `test_micro_bounce_at_top_rejected_by_cadence` originally relied on
      EMA(0.6)'s lag alone to keep the 2-frame flick from even entering the
      "down" state at all — a coincidental side effect of the very lag pillar A
      is removing, not an intentional property. The assertion (`count == 1`,
      i.e. the flick must not register as a second rep) and the exact input
      sequence are both unchanged; only the One-Euro tuning (`ONE_EURO_MAX_DX`
      + a low `ONE_EURO_D_CUTOFF`) was chosen specifically so this case (and
      the new `test_dropout_longer_than_bridge_does_not_invent_a_rep`, the same
      flick shape after a long dropout) keep passing alongside the new
      fast-tempo case below — verified empirically, not just by inspection.
- [x] New `tests/test_one_euro.py` + the fast-tempo, bridged-dropout, and
      reduced-ROM rep cases pass (`test_fast_tempo_reps_no_longer_flattened_by_lag`,
      `test_mid_rep_dropout_within_bridge_limit_still_counts`,
      `test_dropout_longer_than_bridge_does_not_invent_a_rep`,
      `test_reduced_rom_user_counts_after_threshold_calibration`).
- [x] `ruff`, `mypy --strict`, and full `pytest` with coverage >= 80 % all pass.
      `app/analysis` coverage is 97% with the new files. 38 unrelated test
      failures pre-exist on `main` before this change (starlette `TestClient`/
      httpx version mismatch breaking every WS/health/metrics test, plus one
      `starlette.status.HTTP_422_UNPROCESSABLE_CONTENT` rename in
      `app/api/v1/history.py`) — confirmed via `git stash` that they fail
      identically without this change; out of scope here.
- [x] `scripts/eval_rep_counter.py` re-run: clean `overall_accuracy` held at
      `1.0`; `overall_accuracy_25pct_occlusion` improved from `0.9623` to
      `0.9942`; `data/eval/rep_counter_validation.json` updated (now also
      covers `shrug`/`front_raise`/`overhead_triceps`, added since the file was
      last regenerated).
      `scripts/diagnose_rep_counter.py` still raises `KeyError: 'results'` —
      confirmed via `git stash` this is pre-existing and unrelated: it expects
      the original Colab-produced Fit3D JSON schema (`data["results"]`, a flat
      per-clip list), not the local synthetic-benchmark schema
      `eval_rep_counter.py` writes (`summary` / `online_per_exercise` keys).
      That Colab raw-results file is not available locally (18GB Fit3D, Drive-
      only per section 7's own note) — fixing the schema mismatch is out of
      scope for this fix and tracked as the existing Colab Step 12 follow-up.
- [x] New files verified non-truncated (`wc -l` + `ast.parse`).
- [ ] Confirmed on the live tool by Ashwin: a fast set and an off-axis camera.

## 9. Out of scope

- Keypoint/pose model retraining or changing the confidence gate threshold
  (separate perception concern).
- RepNet / learned-counter backbones (separate benchmark track).
- Latency / quantization work.
- Frontend changes — the rep number already renders; no UI contract change.
