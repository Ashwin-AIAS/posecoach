# M3GYM Integration Plan — Two-Track

> Scope decision: **Normal fitness sessions only** (51 of 82). Pilates (17) and Yoga (14)
> are deliberately excluded — they lean on spine articulation, deep twists, and
> floor/inversion poses that COCO-17 single-view cannot score reliably.
>
> Dataset: M3GYM (CVPR 2025), Xu et al. License: **non-commercial academic research only**
> (access-gated). OK for personal tool / dogfooding. NOT usable for the commercial product —
> any monetized version needs Fit3D/Vicon-rights or self-captured data.

## Mental model — the two layers are independent

| Layer | What it does | Datasets that feed it | Output artifact |
|-------|--------------|----------------------|-----------------|
| **Detector** (YOLO26-pose) | Finds 17 COCO keypoints. `nc=1`, never classifies exercises | Kaggle 2D + M3GYM-Normal 2D | ONE `.pt` / `.onnx` weight file |
| **Scorer** (form judgement) | Compares angles to golden ranges, emits 0–100 + cues | Fit3D/Vicon (existing 7) + M3GYM-Normal 3D (new) | `angle_ranges.json` (no weights) |

Key truths:
- You never have "three sets of weights." A detector = **one** weight file. Multiple 2D
  datasets are **merged into one training run** (or sequential fine-tune stages).
- Fit3D was never weights — it is a JSON of golden angles. Same role M3GYM-3D will play.
- Extending the exercise selector does **not** require retraining the detector.

---

## TRACK A — Extend the exercise selector (do this first)

**Why first:** purely additive, no retraining, immediate visible win, cannot break the
existing 7 exercises (they read their own templates).

### Per new exercise, three changes
1. **Template** — derive joint-angle ranges from M3GYM-Normal **3D keypoints**, using only
   frames the sports experts rated as good form. Write into `app/analysis/angle_ranges.json`.
   (Keep 2D projected angles for production per existing convention.)
2. **Scorer** — add a branch in `app/analysis/form_scorer.py`. Decide rep-based vs hold-based
   (plank is the hold-based precedent). Cue strings: max 8 words, plain English.
3. **UI** — add the option to the exercise selector in the frontend.

### Candidate shortlist (COCO-17-safe, from Normal sessions)
Upright / limb-driven, governed by hip/knee/elbow/shoulder angles you already measure:

- Lat pulldown
- Overhead / shoulder press variants
- Lateral raise
- Front raise
- Hammer curl, incline curl
- Tricep pushdown / extension
- Leg press
- Leg extension
- Hip thrust
- Glute bridge
- Calf raise
- Romanian deadlift
- Goblet squat
- Sumo squat
- Step-ups
- Glute kickbacks

This takes the selector from 7 to ~20+ solid options.

### Avoid (won't score on COCO-17)
Anything centered on spine articulation (roll-ups, cat-cow), deep twists, fine wrist/finger
position, or floor/inversion poses. COCO-17 has no spine chain — only hips→shoulders.

### Touchpoints
- `app/analysis/angle_ranges.json`  (additive entries)
- `app/analysis/form_scorer.py`     (additive scorer branches)
- frontend exercise selector        (additive options)
- `tests/test_form_scorer.py`       (add cases for each new exercise)

### Do-not-break
- Never inline angle ranges — always via `ANGLE_RANGES` loaded from the JSON.
- Scorer stays deterministic (same input → same output, no randomness).
- Existing 7 exercises' templates must remain byte-identical — only append.

---

## TRACK B — Retrain / improve the detector (separate, later, validate before swap)

**Why second:** the detector is shared by ALL exercises. Better weights help everyone;
worse weights hurt everyone. So this is gated behind validation.

### Approach: combine, don't pick one
Two valid options for one final weight file:
- **Merge:** train on Kaggle + M3GYM-Normal 2D combined, or
- **Sequential fine-tune (matches existing two-stage style):** start from current weights,
  run a further fine-tune stage on M3GYM-Normal 2D.

More gym-relevant data → better real-world generalization (M3GYM has real gym lighting,
occlusion, mirrors) than Kaggle alone.

### Prep steps
1. Filter M3GYM to the 51 Normal sessions; discard Pilates + Yoga.
2. Use the **single-view, single-person** 2D subset (app is not multi-view/multi-person).
3. **Remap M3GYM skeleton → COCO-17** before training. Verify joint order and the
   56-field label format (1 class + 4 bbox + 17×3). This remap is the main integration cost.
4. Handle mirror reflections in labels (phantom persons) so they don't pollute training.
5. Train on Colab only (RTX 3050 OOMs). Keep `nc=1`, `kpt_shape:[17,3]`, the standard
   `flip_idx`, `end2end` left at default (NEVER `end2end=False`).

### Swap protocol (reversible)
- Validate new weights before adopting: OKS-mAP and latency vs current model.
- Keep current `.pt` / `.onnx` as fallback — swapping is a file replacement, reversible.
- `model.fuse()` BEFORE `model.export()` for ONNX.

### Touchpoints
- `models/` (new weight files; keep old as fallback)
- Colab notebook (data prep + training)
- `scripts/eval_*.py` (validate before swap)

---

## Recommended order
1. **Track A** — extend the selector now. Safe, additive, immediate payoff.
2. **Track B** — retrain detector later as its own validated step.

The two tracks are independent: you can ship a richer exercise list this week without
touching the model, and do the riskier detector work on its own timeline.

## Licensing reminder
M3GYM = non-commercial academic use only. Fine for the personal tool. For the startup/
commercial track, source templates/weights from datasets you hold commercial rights to.

---

## Rollout plan (evaluation-driven)

Current status: most evaluation criteria passed; the **SUS usability test** is the
remaining gate. M3GYM feeds this rollout as follows.

### Step 1 — Now: Track A for the usability test
- Use M3GYM-Normal **golden-angle JSONs** to extend the exercise selector (no retrain).
- Give testers a richer set of exercises to try during the SUS study.

### Step 2 — After: let feedback decide Track B
- If testers report poor accuracy, consider Track B (train detector on M3GYM-Normal 2D).
- Track B is triggered ONLY by genuine keypoint-tracking complaints, not scoring complaints.

### Refinements (so this helps the SUS score, not hurts it)
1. **Quality over quantity.** Don't ship all ~20 candidates raw. Curate 5–8 validated
   exercises — a buggy exercise (bad cues, wrong rep count) drags SUS down harder than a
   missing one. A polished 12-exercise app beats a buggy 25-exercise one.
2. **SUS measures usability, not pose accuracy.** Score rides on flow, clarity,
   responsiveness. New exercises mainly need to add no friction; they won't move SUS alone.
3. **Split the accuracy feedback signal** — this decides whether Track B is even needed:
   - "Skeleton jittery / loses joints in bad lighting" -> **detector** -> Track B (retrain).
   - "Says my squat is wrong when it's fine" -> **scorer / angle template** -> Track A tuning.
   - Ask testers separately: "Did it track your body well?" vs "Was the form advice correct?"
     Track B fires only if complaints are about tracking, not scoring.
