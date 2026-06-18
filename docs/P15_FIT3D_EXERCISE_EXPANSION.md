# P15 — Wire Up Remaining Fit3D Golden-Angle Exercises

> **Prompt for Claude Code.** Execute top to bottom. Every angle range referenced
> here already exists in `app/analysis/angle_ranges.json` — this prompt adds
> **zero new data** and **zero model changes**. It is pure wiring: scorer,
> rep counter, verifier, frontend, tests.

---

## 0. Context — Read First

- The YOLO26 model is `nc=1` (person only). Exercise identity comes from the UI.
  **Adding exercises requires NO retraining, NO dataset work, NO model changes.**
- `angle_ranges.json` holds Fit3D golden percentiles (p5/p25/p50/p75/p95) for 28
  named movements. The app currently exposes 15. This prompt wires up **3 more**
  that map to the owner's real gym routine:

| New UI exercise | Fit3D data key (exists in angle_ranges.json) | Real-world use |
|---|---|---|
| `shrug` | `barbell_shrug` | Trap shrugs — machine, dumbbell, Smith |
| `front_raise` | `dumbbell_scaptions` | Cable/dumbbell front raises (scaption plane) |
| `overhead_triceps` | `overhead_extension_thruster` | Cable/DB overhead triceps extension |

- **No-code mappings** (just user education, no changes): machine single-arm row
  → use `one_arm_row`; Smith OHP → `ohp`; incline Smith press → `bench`
  (approximation); dumbbell rows → `one_arm_row`.
- All other machine exercises (lat pulldown, seated row, leg extension, flyes,
  leg press, etc.) have **no Fit3D data** and are explicitly **OUT OF SCOPE**
  for P15. They come later via self-calibration (P16). Do not invent ranges
  for them.

### Hard rules (unchanged from CLAUDE.md — violations are bugs)
- Angle ranges come from `angle_ranges.json` via `_EXERCISE_DATA_KEY` — **never
  inline magic angle values** in scorer logic.
- Cue strings: **max 8 words**, plain English, no jargon.
- Scorer stays deterministic. structlog only. mypy --strict clean. ruff clean.
- Do not touch: model loading, inference path, smoothers, WebSocket protocol.

---

## 1. Backend — `app/analysis/form_scorer.py`

### 1a. `SUPPORTED_EXERCISES`
Add `"shrug"`, `"front_raise"`, `"overhead_triceps"` to the frozenset under a
comment `# P15 expansion (Fit3D-backed)`.

### 1b. `_EXERCISE_DATA_KEY`
```python
"shrug": "barbell_shrug",
"front_raise": "dumbbell_scaptions",
"overhead_triceps": "overhead_extension_thruster",
```

### 1c. `_EXERCISE_JOINTS`
Joint roles were chosen from the actual Fit3D percentile spreads (verified):

```python
# shrug: arms hang straight (elbow ~147-169 = posture), shoulder angle sweeps
# as the dumbbells/bar ride up (p5 ~37-47 -> p95 ~110-114 = mover)
"shrug": ["left_shoulder_angle", "right_shoulder_angle", "left_elbow_angle", "right_elbow_angle"],
# front_raise: shoulder is the mover (p5 ~39-53 -> p95 ~140-143),
# elbow stays nearly straight (p5 ~135-142 -> p95 ~173 = posture)
"front_raise": ["left_shoulder_angle", "right_shoulder_angle", "left_elbow_angle", "right_elbow_angle"],
# overhead_triceps: elbow is the mover (p5 ~34 -> p95 ~167-168 huge ROM),
# shoulder stays elevated (p25 ~85-96 -> p75 ~131-133 = posture)
"overhead_triceps": ["left_elbow_angle", "right_elbow_angle", "left_shoulder_angle", "right_shoulder_angle"],
```

### 1d. `_POSTURE_JOINTS`
```python
"shrug": frozenset({"left_elbow_angle", "right_elbow_angle"}),
"front_raise": frozenset({"left_elbow_angle", "right_elbow_angle"}),
"overhead_triceps": frozenset({"left_shoulder_angle", "right_shoulder_angle"}),
```

### 1e. `_CUES` (all ≤8 words — verify by counting)
```python
"shrug": {
    "left_shoulder_angle": {"low": "Let arms hang fully down", "high": "Shrug straight up, not forward"},
    "right_shoulder_angle": {"low": "Let arms hang fully down", "high": "Shrug straight up, not forward"},
    "left_elbow_angle": {"low": "Keep arms straight, don't curl", "high": "Relax your arms"},
    "right_elbow_angle": {"low": "Keep arms straight, don't curl", "high": "Relax your arms"},
},
"front_raise": {
    "left_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
    "right_shoulder_angle": {"low": "Raise arms to shoulder height", "high": "Stop at shoulder height"},
    "left_elbow_angle": {"low": "Keep arms nearly straight", "high": "Soften your elbows slightly"},
    "right_elbow_angle": {"low": "Keep arms nearly straight", "high": "Soften your elbows slightly"},
},
"overhead_triceps": {
    "left_elbow_angle": {"low": "Stretch deeper behind your head", "high": "Extend to full lockout"},
    "right_elbow_angle": {"low": "Stretch deeper behind your head", "high": "Extend to full lockout"},
    "left_shoulder_angle": {"low": "Keep elbows pointing up", "high": "Tuck elbows closer in"},
    "right_shoulder_angle": {"low": "Keep elbows pointing up", "high": "Tuck elbows closer in"},
},
```

### 1f. Known caveat — document it, don't fix it
`overhead_extension_thruster` source clips include a leg-drive (thruster)
component, which is why knees/hips are NOT scored for `overhead_triceps`.
Add a one-line comment above its `_EXERCISE_DATA_KEY` entry noting this.

---

## 2. Backend — `app/analysis/rep_counter.py`

Add to `REP_SIGNAL` (mirror the existing style and comments):

```python
# Shrug — shoulder elevation drives, straight arms are context
"shrug": RepSignal(
    ("left_shoulder_angle", "right_shoulder_angle"),
    ("left_elbow_angle", "right_elbow_angle"),
),
# Raise — shoulder flexion drives
"front_raise": RepSignal(("left_shoulder_angle", "right_shoulder_angle")),
# Overhead extension — elbow drives, elevated shoulder is context
"overhead_triceps": RepSignal(
    ("left_elbow_angle", "right_elbow_angle"),
    ("left_shoulder_angle", "right_shoulder_angle"),
),
```

⚠️ **Shrug rep-count risk:** scapular elevation produces a small angular sweep;
the Fit3D shoulder band is wide partly from arm-dangle variance. After wiring,
run the synthetic-curve test (section 5). If the state machine misses shrug
reps because the required ROM fraction of the p5–p95 band is too large, reduce
the per-rep ROM threshold **for shrug only** via whatever per-exercise
threshold hook exists in `_JointRepMachine` — if none exists, add an optional
`rom_fraction` field to `RepSignal` (default keeps current behavior; only
shrug overrides it). Keep it deterministic.

---

## 3. Backend — `app/analysis/exercise_verifier.py`

Add to `EXERCISE_SIGNATURES`:

```python
"shrug": ExerciseSignature(
    ("left_shoulder_angle", "right_shoulder_angle"),
    absent_hint="Shrug your shoulders up",
),
"front_raise": ExerciseSignature(
    ("left_shoulder_angle", "right_shoulder_angle"),
    absent_hint="Raise your arms forward",
),
"overhead_triceps": ExerciseSignature(
    ("left_elbow_angle", "right_elbow_angle"),
    absent_hint="Extend your elbows overhead",
),
```

Check how `_KNEES`/`_ELBOWS` tuples are defined at the top of the file — if a
`_SHOULDERS` tuple constant fits the existing pattern, define and reuse it
instead of repeating literals.

---

## 4. Frontend

### 4a. `frontend/src/types.ts`
Add `"shrug" | "front_raise" | "overhead_triceps"` to the `Exercise` union AND
to the `EXERCISES` array (keep union and array in sync — the array drives
selector order).

### 4b. `frontend/src/lib/exercises.ts`
Add three `EXERCISE_META` entries. `Record<Exercise, ExerciseMeta>` makes
missing entries a compile error — let the compiler guide you.

```ts
shrug: {
  id: "shrug",
  label: "Shrug",
  category: "Pull",
  primaryMuscles: ["Traps"],
  youtubeId: "<VERIFIED — see rule below>",
  difficulty: "Beginner",
  formTips: ["Straight arms, shrug straight up", "Pause at the top, lower slow"],
},
front_raise: {
  id: "front_raise",
  label: "Front Raise",
  category: "Shoulders",
  primaryMuscles: ["Front Delts"],
  youtubeId: "<VERIFIED>",
  difficulty: "Beginner",
  formTips: ["Raise to shoulder height only", "No swinging — strict and slow"],
},
overhead_triceps: {
  id: "overhead_triceps",
  label: "Overhead Triceps Extension",
  category: "Arms",
  primaryMuscles: ["Triceps"],
  youtubeId: "<VERIFIED>",
  difficulty: "Beginner",
  formTips: ["Elbows up, close to head", "Stretch deep, extend to lockout"],
},
```

**YouTube ID rule (matches how the existing 15 were curated):** pick a short
form-demo video from a reputable channel for each exercise, then verify every
id is real and embeddable via oEmbed before committing:
```bash
curl -s "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json"
```
A JSON response with a sensible title = pass. HTTP 4xx = pick another video.
**Never commit an unverified id.**

### 4c. Repo-wide sweep for hardcoded exercise lists
```bash
grep -rn "hammer_curl" --include="*.py" --include="*.ts" --include="*.tsx" -l .
```
Visit every hit (known: `scripts/diagnose_rep_counter.py`, frontend tests,
`docs/`) and decide: does it enumerate exercises and need the 3 new ones?
Update counts in `ExerciseSelector.test.tsx` and any test asserting the number
of exercises or categories.

---

## 5. Tests (write these BEFORE claiming done)

1. **`tests/test_form_scorer.py`** — add the 3 exercises to every parametrized
   list that runs per-exercise (valid FormResult, cue length ≤8 words, etc.).
2. **`tests/test_form_consistency.py`** — if it iterates `SUPPORTED_EXERCISES`
   dynamically, it picks the new ones up free; confirm. If it has a hardcoded
   list, extend it. Variance must stay <5% on 20 identical inputs.
3. **`tests/test_rep_counter.py`** — synthetic angle curves for each new
   exercise: oscillate the PRIMARY joint between its Fit3D p5 and p95
   (read via `joint_range()`, do not hardcode degrees) for 5 cycles → expect
   5 reps. For shrug this test decides whether the `rom_fraction` override
   (section 2) is needed.
4. **Verifier tests** — wrong-movement check: feed squat-like knee motion while
   exercise=`front_raise` → expect non-verified/mismatch path consistent with
   how existing tests assert it.
5. **Frontend** — `npx vitest run` green; `tsc` catches any missed
   `Record<Exercise, ...>` entry.

---

## 6. Quality Gate (all must pass — no exceptions)

```bash
ruff check app/ --fix
mypy app/ --strict
pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80
cd frontend && npx vitest run
```

---

## 7. Commit

```
[P15] feat: add shrug, front raise, overhead triceps (Fit3D-backed)

- wire 3 exercises into scorer/rep counter/verifier from existing golden angles
- frontend selector, meta, verified youtube demos
- synthetic rep + consistency + verifier tests
```

Single commit. Push from Windows (LFS), then redeploy per the usual HF Space flow.

---

## 8. Acceptance Checklist

- [ ] 18 exercises in `SUPPORTED_EXERCISES`, selector, and `Exercise` union
- [ ] Zero inline angle values added anywhere
- [ ] All cue strings ≤8 words
- [ ] 3 YouTube ids oEmbed-verified
- [ ] Shrug rep counting validated with synthetic curve (override only if needed)
- [ ] Quality gate green (ruff, mypy --strict, pytest cov ≥80, vitest)
- [ ] `overhead_triceps` thruster-source caveat documented in code comment
