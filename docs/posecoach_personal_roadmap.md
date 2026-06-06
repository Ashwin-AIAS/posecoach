# PoseCoach — Personal Use Roadmap

> Created: 2026-06-03
> Owner: Ashwin
> Status: Active

## Context — read this first

PoseCoach was a master's thesis project. **The thesis was dropped on 2026-06-01** after the supervisor did not value the work. The project now continues as:

1. A personal daily-driver tool to replace Ashwin's gym Excel log.
2. A future startup idea.

All thesis-metric gating is deprecated. Build for the user (Ashwin), not for examiners.

### IMPORTANT: which progress file is real

- `CLAUDE.md` (repo root, checked-in) is **STALE** — it still says "P03 is next."
- `CLAUDE.local.md` (gitignored, personal) is the **actual** progress tracker.

Real status as of 2026-06-03:
- **P01–P09: COMPLETE** ✅
- **P10: mostly done**; remaining items (chatbot accuracy eval, user study collection, Qwen VLM judge) are **obsolete** because the thesis is dropped.

---

## Real-world findings (from in-gym testing, 2026-06-03)

| Area | Observed behavior | Action |
|---|---|---|
| Lighting handling | Works fine | No action |
| Tracking latency | Noticeable delay during streaming | P11 → P15 |
| Rep counter | Stuck at `0` live, despite 71% eval accuracy | **P0 bug — P11 → P12** |
| Existing 7 exercise scoring | Few work, majority silently broken | **P0 bug — P11 → P13** |
| New exercises from real routine | Not supported (RDL, hip thrust, rows, lateral raise, hammer curl, etc.) | P14 |
| Background camera | Not implemented | P16 (later) |

### Critical insight
The rep counter passing 71% in eval but returning **0** live is almost certainly a **plumbing bug**, not a model bug. Same for "most exercises silently broken" — almost certainly silent fallback paths, not model failure. **Both must be diagnosed before any code changes**, or weeks will be spent "improving the model" when the actual bug is a missing field in the WS response payload.

---

## Goal

Make the app good enough that Ashwin opens it every gym day instead of Excel. Specifically:

- Rep counter reports correctly during streaming for every supported exercise.
- All 7 existing + 12 new Tier 1 exercises score reliably with correct cues and worst-joint detection.
- Perceived tracking delay under ~150 ms.
- Camera continues running while user actually performs the set.

---

## Workstreams (5 tickets)

### Triage and dependency table

| Ticket | Priority | Depends on | Can run parallel with |
|---|---|---|---|
| **P11** Diagnostics + instrumentation | P0 | — | (must run alone, first) |
| **P12** Fix rep counter live | P0 | P11 | P13 |
| **P13** Fix silently-broken existing 7 | P0 | P11 | P12 |
| **P14** Templatize angle_ranges + add 12 new exercises | P1 | P13 | P15 |
| **P15** Latency reduction | P1 | P11 | P14 |

Run P11 alone first. Then P12 and P13 in parallel (two Claude Code sessions, each in its own worktree). Once both merge, do P14 and P15 in parallel.

---

## P11 — Diagnostics & instrumentation (FIRST, run alone)

### Goal
Add instrumentation only. **Do not change behavior**. Produce a diagnostic report identifying root causes so P12–P15 can fix the right things instead of guessing.

### Tasks
1. In `app/api/v1/ws_inference.py`, add structured `structlog` logging with per-frame timing for each pipeline stage:
   - `frame_decode_ms` (cv2.imdecode)
   - `inference_ms` (YOLO predict in executor)
   - `keypoint_smooth_ms`
   - `scoring_ms` (form_scorer.score)
   - `rep_count_ms` (rep_counter call — if it's even being called)
   - `score_smooth_ms`
   - `serialize_send_ms`
   - `total_loop_ms`
   - Emit log every 30 frames (not every frame) to avoid spam.
2. Add Prometheus histograms in `app/monitoring/metrics.py` for the same stages, labeled by `exercise`.
3. On WS connection establishment, log the FULL response payload structure ONCE. Explicitly verify that `rep_count` is in the JSON sent to the client. If the field is missing, that's the rep counter bug.
4. Audit per-connection rep counter state:
   - Is there a `RepCounter` instance per WS connection?
   - Does its `angle_history` buffer persist across frames?
   - Is `.reset()` called on disconnect, not per-frame?
   - Log buffer length and last detected peak count every 30 frames.
5. Create `tests/test_exercise_dispatch.py` — a diagnostic harness. For each of the 7 supported exercises (`squat, deadlift, curl, bench, ohp, lunge, plank`):
   - Feed a 60-frame synthetic keypoint sequence with a clear rep pattern.
   - Pipe through the full scoring pipeline (mock the WS connection).
   - Assert: `score > 0`, `score != default_value`, `worst_joint` populated, `cue` non-empty, `rep_count > 0`.
   - Report which exercises pass/fail and at which stage.
6. Write a one-page Markdown report at `docs/p11_diagnostics.md`:
   - Latency breakdown table (mean + p95 per stage)
   - Rep counter state diagnosis (exactly where it's broken)
   - Per-exercise pass/fail table
   - Recommended fix priority order for P12 and P13

### Rules (must follow)
- `structlog` only — never `print()` or `logging.getLogger()`
- NEVER log frame bytes — only metadata (shape, ms)
- NEVER pass `end2end=False` to YOLO
- All existing tests must still pass: `pytest -x --timeout=30`
- `ruff check app/ --fix` + `ruff format app/` + `mypy app/ --strict` must be clean

### Acceptance gates
```bash
ruff check app/ --fix
ruff format app/
mypy app/ --strict
pytest -x --timeout=30
pytest -x --timeout=30 tests/test_exercise_dispatch.py -v
```
Plus: `docs/p11_diagnostics.md` exists and clearly explains what's broken.

### Commit
```
[P11] feat: pipeline instrumentation + per-exercise diagnostic harness

- Per-frame timing logs in ws_inference (every 30 frames)
- Prometheus histograms for each pipeline stage
- Rep counter state audit + buffer-length logging
- Synthetic 60-frame harness for all 7 exercises
- docs/p11_diagnostics.md with findings + recommended fix order
```

### STOP CONDITION
After P11 commits, **stop**. Bring `docs/p11_diagnostics.md` back to me so P12 and P13 prompts can be written against real data instead of guesses.

---

## P12 — Fix rep counter for live streaming (skeleton)

To be refined after P11 results. Likely scope:
- Ensure one `RepCounter` instance per WS connection, state persisted across frames
- Verify `rep_count` field is included in WS response payload
- Recalibrate `scipy.signal.find_peaks` params for live FPS (~15) vs eval FPS (~50)
- Reset only on disconnect, never per-frame
- Add regression test: simulated streaming rep sequence, assert `rep_count > 0`

## P13 — Fix silently-broken exercises among the 7 (skeleton)

To be refined after P11 results. Likely scope:
- For each of the 7 exercises, ensure `form_scorer.score` either returns a real result or **raises** — no silent defaults
- Fix missing `ANGLE_RANGES` entries, broken cue templates, edge-case fallbacks
- Add a CI test that exercises all 7 with synthetic keypoints and fails if any returns default

## P14 — Templatize angle_ranges.json + Tier 1 expansion

Refactor so adding an exercise = JSON edit + one filmed validation, not a code change.

Add these 12 exercises from Ashwin's actual routine:
1. RDL
2. Hip thrust
3. Barbell row
4. Single-arm DB row
5. Chest-supported row
6. Incline DB press
7. DB lateral raise
8. DB curl (distinct from existing `curl`)
9. Hammer curl
10. Standing calf raise
11. Hanging leg raise
12. Bulgarian split squat

For each: define joint triplets, derive angle ranges from Ashwin's own filmed reference reps (Vicon doesn't cover most). Validate with `tests/test_exercise_dispatch.py` (extended).

## P15 — Latency reduction

Driven by P11's latency breakdown. Likely targets:
- Reduce JPEG quality on high RTT
- Drop frame resolution to 480p when CPU-bound
- Confirm ONNX model is loaded (not `.pt`) in production
- Drop client FPS to 10 on weaker phones (adaptive)

No premature optimization. Measure first.

---

## Out of scope (intentionally not in this roadmap)

- Frontend log UI improvements (replace Excel) — separate roadmap
- Tier 2 cable exercises — after Tier 1 ships
- Tier 3 machine exercises (rep + log only) — easy UI work
- PWA background camera / wake lock — P16 (later)
- Production deploy improvements — current setup OK for personal use
- Thesis-related work — dropped

---

## Engineering principles

1. **Diagnose before fix.** P11 always runs before any other fix.
2. **No silent defaults.** Per-exercise scoring must raise, not return a zero or fallback.
3. **Live FPS ≠ eval FPS.** Calibrate streaming params to ~15 FPS, not 50.
4. **`structlog` only.** Never `print()` or `logging.getLogger()`.
5. **Every fix lands with a regression test** that would have caught the original bug.
6. **Stop at each P-prompt boundary**, report findings, then proceed.

---

## Workflow with Claude Code

For each P-prompt:
1. Open a clean git branch.
2. Paste the prompt block into Claude Code.
3. Let it use `TodoWrite` to plan tasks.
4. **Review the plan before letting it implement.**
5. Once implemented, run the acceptance gates.
6. Commit with the specified message.
7. Return here, share findings, and we'll write the next prompt.

Use existing `.claude/` infrastructure where it helps:
- `prompt-planner` agent for breaking work into atomic tasks
- `code-reviewer` agent for sanity-checking the diff before commit
- `/verify` command to run the full acceptance gate
- `/checkpoint` command when a P-prompt is fully done

Do NOT skip the planning step. Especially for P11, the temptation will be to jump straight to fixes — resist it. Diagnostics first.
