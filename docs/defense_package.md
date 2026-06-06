# PoseCoach Thesis Defense Package

## Research Question

> To what extent can a YOLO26-Pose-based mobile system achieve clinically acceptable joint angle accuracy (MAE ≤ 5°), sub-80 ms end-to-end inference latency on CPU, and meaningful user-perceived coaching effectiveness (SUS ≥ 70) for resistance training form correction under real gym conditions — and does integrating a domain-specific RAG chatbot produce measurably superior coaching quality compared to visual feedback alone?

---

## Part 1: PoseCoach vs Ultralytics AIGym — Feature Comparison

This table is designed for your Related Work or System Design chapter. It makes the scope distinction crystal clear for an examiner.

| Dimension | Ultralytics AIGym | PoseCoach (This Thesis) |
|---|---|---|
| **Primary purpose** | Rep counting | Real-time form quality assessment + corrective coaching |
| **Pose model** | Pretrained YOLO-Pose (COCO weights) | YOLO26-Pose fine-tuned on gym-domain data (dual-dataset strategy) |
| **Ground truth validation** | None reported; no accuracy claims against clinical reference | Validated against Vicon marker-based motion capture (25-joint 3D skeletons) |
| **Accuracy metric** | Not applicable (binary up/down classification) | Mean Absolute Error (MAE) on joint angles, target ≤ 5° |
| **Form assessment** | None — only detects whether angle crossed a threshold | Multi-joint angle analysis with exercise-specific correctness criteria |
| **Feedback mechanism** | Visual overlay (rep count displayed on frame) | Visual overlay + natural-language corrective cues + RAG chatbot for exercise guidance |
| **Exercise coverage** | 3 types (pushup, pullup, abworkout) with manual keypoint config | 47 exercise types across warmups, barbell, dumbbell, and equipment-free categories |
| **Keypoint usage** | 3 keypoints per exercise (e.g., shoulder-elbow-wrist) | Full 17-keypoint skeleton; exercise-specific joint subsets for angle computation |
| **Angle logic** | Two hardcoded thresholds: `up_angle=145°`, `down_angle=90°` | Dynamic angle computation per exercise phase; clinically referenced ROM thresholds |
| **Temporal analysis** | None — frame-by-frame only | Rep segmentation with phase detection (eccentric/concentric); tempo analysis |
| **Tracking** | BoTSORT/ByteTrack for multi-person | BoTSORT/ByteTrack for multi-person (inherited from YOLO26) |
| **Architecture** | Python script (CLI or OpenCV loop) | Full-stack system: FastAPI backend, WebSocket inference, React PWA frontend, PostgreSQL |
| **Deployment target** | Desktop Python environment | Mobile-first PWA; CPU inference target with sub-80 ms latency requirement |
| **User study** | None reported | SUS-based evaluation with N participants; A/B comparison (visual-only vs. visual + RAG) |
| **Personalization** | None | User history, session tracking, personalized RAG responses based on exercise history |
| **Clinical framing** | None | Joint angles validated against Vicon; MAE ≤ 5° threshold from biomechanics literature |
| **Open source** | Yes (part of `ultralytics` package) | Thesis prototype (to be open-sourced post-submission) |

### How to use this table in your thesis

Place this in your **Related Work** chapter, Section 2.X (e.g., "Existing Pose-Based Fitness Systems"). Introduce it with a paragraph like:

> "Ultralytics provides AIGym, a rep-counting utility built on YOLO-Pose. While AIGym demonstrates the feasibility of pose-based exercise monitoring, it addresses a fundamentally different problem than PoseCoach. AIGym performs binary state detection (up vs. down) using hardcoded angle thresholds on three keypoints, whereas PoseCoach aims to assess form quality across multiple joints against clinically validated accuracy thresholds. Table X summarizes the key distinctions."

After the table, add one sentence of transition:

> "PoseCoach builds on the same underlying pose estimation architecture but extends it with domain-specific fine-tuning, multi-joint form assessment, and an integrated RAG coaching system — none of which are addressed by existing solutions."

---

## Part 2: Ablation Experiment Protocol (RQ Prong 1 — Joint Angle Accuracy)

### 2.1 Objective

Determine whether domain-specific fine-tuning improves joint angle estimation accuracy for gym exercises, and whether the dual-dataset strategy (gym + COCO mix) outperforms gym-only fine-tuning.

### 2.2 Dataset: Vicon Ground Truth

You have a strong dataset. Here is how to use it:

**Training split:**
- 8 subjects (all trainees)
- 4 camera views per recording
- 50 fps, 900×900 resolution
- Ground truth: 25-joint 3D skeletons from Vicon markers

**Test split:**
- 3 subjects (1 trainer, 2 trainees) — held-out, never seen during training
- 1 random camera view per sequence (no multi-view advantage)
- Same ground truth quality

**Critical note for your thesis:** The test set uses a single random viewpoint. This is actually a strength — it simulates real-world conditions where a user has one phone camera, not a multi-camera lab setup. State this explicitly: "The test protocol uses a single arbitrary viewpoint per sequence, reflecting the deployment scenario where users record exercises from a single smartphone."

### 2.3 Experimental Conditions (3-way ablation)

| Condition | Training Data | Rationale |
|---|---|---|
| **A: Pretrained (baseline)** | COCO only (no fine-tuning) | Tests whether off-the-shelf YOLO26-Pose is sufficient for gym-domain accuracy |
| **B: Gym-only fine-tune** | Vicon TRAIN set only (8 subjects, 4 views) | Tests domain-specific fine-tuning without preservation of general knowledge |
| **C: Dual-dataset (proposed)** | Vicon TRAIN set + COCO subset (mixed batches) | Tests whether mixing source-domain data prevents catastrophic forgetting while gaining gym-domain accuracy |

**Dual-dataset mixing strategy (Condition C):**
- Mixing ratio: Start with 70% gym / 30% COCO; report the ratio you used and whether you tuned it
- COCO subset: Use COCO images that contain `person` class with visible keypoints (filter out crowd scenes with heavy occlusion)
- Training schedule: Same hyperparameters across B and C (learning rate, epochs, augmentation) — only the data composition changes
- If you tune the mixing ratio, that's a bonus result. If not, cite prior work on replay-based continual learning for your choice of 70/30

### 2.4 Metrics

**Primary metric:**
- **MAE (Mean Absolute Error) on joint angles in degrees** — computed per exercise type, per joint, and aggregated
- Threshold: ≤ 5° (from your reference [13])

**How to compute joint angles from keypoints:**
1. Extract 2D keypoint predictions from YOLO26-Pose on each test frame
2. Compute joint angles using the standard 3-point angle formula: `angle = arccos((a·b) / (|a||b|))` where `a` and `b` are vectors from the middle joint to the two outer joints
3. Extract corresponding ground-truth joint angles from the Vicon 3D skeletons (project to 2D using the camera intrinsics/extrinsics provided in the dataset, OR compute angles in 3D and compare — document which you chose and why)
4. MAE = mean of |predicted_angle − ground_truth_angle| across all frames in the test set

**Key joints to report (at minimum):**
- Knee angle (hip-knee-ankle) — squats, lunges
- Elbow angle (shoulder-elbow-wrist) — curls, presses, pushups
- Hip angle (shoulder-hip-knee) — deadlifts, bent-over rows
- Shoulder angle (elbow-shoulder-hip) — overhead press, lateral raises

**Secondary metrics:**
- **PCK@0.05 and PCK@0.1** (Percentage of Correct Keypoints) — standard in pose estimation literature; reports what fraction of predicted keypoints fall within a threshold distance of ground truth (normalized by torso length)
- **OKS (Object Keypoint Similarity)** — the COCO standard metric; compute mAP at OKS thresholds
- **Per-exercise-type breakdown** — essential to show whether some exercises benefit more from fine-tuning than others (e.g., barbell exercises with equipment occlusion vs. equipment-free exercises)

### 2.5 Statistical Analysis

With 3 test subjects and multiple exercises, you have repeated measures. Use:

- **Paired analysis:** Each test frame has predictions from all three conditions (A, B, C) on the same ground-truth frame, so use paired comparisons
- **Wilcoxon signed-rank test** (non-parametric) for pairwise comparison of MAE distributions between conditions — don't assume normality with this sample structure
- **Effect size:** Report Cohen's d or rank-biserial correlation alongside p-values. A statistically significant result with tiny effect size is not practically meaningful
- **Bonferroni correction:** You're doing 3 pairwise comparisons (A vs B, A vs C, B vs C), so adjust your significance threshold to α = 0.05/3 ≈ 0.017
- **Confidence intervals on MAE** — report 95% CI, not just point estimates

### 2.6 Results Table Template

Prepare this table structure before running experiments:

| Condition | Knee MAE (°) | Elbow MAE (°) | Hip MAE (°) | Shoulder MAE (°) | Overall MAE (°) | PCK@0.05 | PCK@0.1 |
|---|---|---|---|---|---|---|---|
| A: Pretrained COCO | — | — | — | — | — | — | — |
| B: Gym-only fine-tune | — | — | — | — | — | — | — |
| C: Dual-dataset (ours) | — | — | — | — | — | — | — |
| *Clinically acceptable* | *≤ 5°* | *≤ 5°* | *≤ 5°* | *≤ 5°* | *≤ 5°* | — | — |

### 2.7 What If the Results Don't Support Fine-Tuning?

Be prepared for these outcomes:

- **If A (pretrained) already hits ≤ 5°:** That's still a valid finding. Report it as: "The pretrained YOLO26-Pose model achieves clinically acceptable accuracy for gym exercises without domain-specific fine-tuning, suggesting strong generalization of COCO-trained pose models to the fitness domain." Your contribution shifts to the system and the RAG comparison.

- **If B beats C (gym-only > dual-dataset):** Report it honestly. This would mean catastrophic forgetting wasn't a problem for this dataset size, and the COCO mix just diluted training signal. That's a real methodological insight.

- **If C beats B but not A:** The fine-tuning didn't help regardless of strategy. This is still publishable as a negative result with clinical implications.

**The point:** Any of these outcomes answers your RQ. You committed to measuring, not to a specific outcome. That's what makes it research, not a sales pitch.

---

## Part 3: Evaluation Protocols (RQ Prongs 2–4)

### 3.1 Prong 2: End-to-End Inference Latency (Target: < 80 ms on CPU)

**What to measure:**
Break down the full pipeline into timed segments:

| Pipeline Stage | What It Includes |
|---|---|
| Frame capture | WebSocket receive + decode |
| Preprocessing | Resize, normalize, letterbox |
| Model inference | YOLO26-Pose forward pass |
| Postprocessing | Keypoint extraction, NMS (if applicable), confidence filtering |
| Angle computation | Joint angle calculation from keypoints |
| Feedback generation | Rule-based form assessment + overlay rendering |
| **Total end-to-end** | **Frame in → feedback out** |

**How to measure:**
- Use `time.perf_counter_ns()` (Python) for each stage — NOT `time.time()` (too coarse)
- Run on a **specified CPU** — report exact hardware: e.g., "Intel Core i7-12700H, 16 GB RAM, no GPU acceleration"
- Also report on a **representative mobile-class CPU** if possible (e.g., Raspberry Pi 4, or an older laptop CPU) to test the "mobile" claim in your RQ
- Warm-up: Discard the first 100 frames (model loading, JIT compilation, cache warming)
- Measurement window: Time at least 1000 consecutive frames
- Report: **p50, p95, p99 latency** and **mean ± std** — an examiner will ask about tail latency
- Export format: Test with ONNX Runtime (CPU) — this is the realistic deployment format, not PyTorch eager mode

**Results table template:**

| Stage | p50 (ms) | p95 (ms) | p99 (ms) | Mean ± SD (ms) |
|---|---|---|---|---|
| Frame capture | — | — | — | — |
| Preprocessing | — | — | — | — |
| Model inference | — | — | — | — |
| Postprocessing | — | — | — | — |
| Angle computation | — | — | — | — |
| Feedback generation | — | — | — | — |
| **End-to-end** | **—** | **—** | **—** | **—** |

**Hardware tested:** [exact CPU model, RAM, OS, Python version, ONNX Runtime version]

### 3.2 Prong 3: User-Perceived Coaching Effectiveness (Target: SUS ≥ 70)

**Study design:**

- **Participants:** Recruit 12–15 participants (minimum 10 for statistical validity with SUS)
  - Mix of experience levels: ~5 beginners, ~5 intermediate, ~2–3 experienced lifters
  - Document demographics: age range, training experience (months/years), prior use of fitness apps
  - If your university requires ethics approval for human subjects research, apply NOW — this can take 4–8 weeks

- **Task protocol (per participant):**
  1. Brief orientation (2 min): Explain PoseCoach, demonstrate one exercise
  2. Guided session (15–20 min): Participant performs 3–4 exercises (e.g., squat, overhead press, bicep curl, Romanian deadlift) while PoseCoach provides real-time feedback
  3. Free exploration (5 min): Participant uses the RAG chatbot to ask questions about form
  4. Post-session questionnaire: SUS + custom questions (see below)

- **System Usability Scale (SUS):**
  - Use the standard 10-item SUS questionnaire (Brooke, 1996) — do NOT modify the wording
  - Score range: 0–100; ≥ 70 = "acceptable," ≥ 80 = "good," ≥ 85 = "excellent"
  - Report: mean SUS score, standard deviation, and individual scores (anonymized)

- **Custom supplementary questions (Likert 1–5):**
  1. "The system correctly identified errors in my exercise form." (Perceived accuracy)
  2. "The feedback was timely enough to correct my form during the exercise." (Perceived latency)
  3. "I would trust this system to guide my workouts without a human trainer." (Trust)
  4. "The chatbot provided useful additional guidance beyond the visual feedback." (RAG value — feeds into Prong 4)

- **Qualitative data:** Record 2–3 open-ended observations per participant. Note moments of confusion, delight, or frustration. These are gold for your Discussion chapter.

### 3.3 Prong 4: RAG Chatbot vs. Visual Feedback Alone (A/B Comparison)

**Study design: Within-subjects crossover**

Why within-subjects: With only 12–15 participants, a between-subjects design gives you ~6 per group — far too few for statistical power. A crossover design uses each participant as their own control.

**Protocol:**

| Session | Group A (n ≈ 7) | Group B (n ≈ 7) |
|---|---|---|
| Session 1 (Day 1) | Visual feedback only | Visual + RAG chatbot |
| Session 2 (Day 2+) | Visual + RAG chatbot | Visual feedback only |

- **Washout period:** At least 24 hours between sessions to reduce learning effects
- **Exercise counterbalancing:** Use different exercises in Session 1 vs. Session 2 (e.g., Session 1 = squat + OHP; Session 2 = deadlift + curl) to avoid practice effects on the same movement
- **Randomize group assignment** — flip a coin or use a random number generator; document the method

**Dependent variables:**

| Metric | How to Measure | Expected Direction |
|---|---|---|
| Form correction rate | % of flagged form errors that the participant corrected within 3 reps | Higher with RAG |
| Task completion accuracy | Final-rep joint angle deviation from target ROM | Lower deviation with RAG |
| SUS score (per condition) | Standard SUS after each session | Higher with RAG |
| Perceived coaching quality | Custom Likert items (see 3.2 above) | Higher with RAG |
| Engagement | Time spent in session; number of chatbot queries | More queries = more engagement |

**Statistical analysis:**

- **Wilcoxon signed-rank test** on paired differences (visual-only score vs. visual+RAG score per participant) — non-parametric, appropriate for small N and ordinal Likert data
- **Report effect size** (rank-biserial correlation r) — with small N, effect size matters more than p-values
- **Crossover effects check:** Compare Session 1 vs. Session 2 performance regardless of condition to test whether order (learning effect) is significant. If it is, include order as a covariate or report it as a limitation

**What if there's no significant difference?**

This is a real possibility with N ≈ 12. If p > 0.05, do NOT spin this as failure. Report it as: "While the RAG condition showed a trend toward higher coaching quality scores (median = X vs. Y), the difference did not reach statistical significance (W = _, p = _, r = _), likely due to the limited sample size. A power analysis suggests N ≥ 30 would be required to detect an effect of this magnitude (d = _) at α = 0.05 with 80% power." Then flag it as future work. This is honest science and examiners respect it.

---

## Part 4: Defense Preparation — Anticipated Examiner Questions

### Q1: "Why not just use AIGym?"
**Answer:** "AIGym counts reps via hardcoded angle thresholds. PoseCoach assesses form quality against clinically validated accuracy targets. Table X in Chapter 2 details the distinctions. They solve different problems."

### Q2: "What's novel here? You're just using YOLO."
**Answer:** "The contribution is threefold: (1) empirical validation of YOLO26-Pose joint angle accuracy against Vicon motion capture ground truth under gym conditions, (2) a complete real-time coaching system achieving sub-80 ms latency on CPU, and (3) the first controlled comparison of RAG-augmented coaching versus visual-only feedback for resistance training. The model is a component; the system and its evaluation are the contribution."

### Q3: "Your sample size is too small for the user study."
**Answer:** "I acknowledge the limited sample size and have used non-parametric tests appropriate for small N. I report effect sizes alongside p-values, and include a post-hoc power analysis indicating the sample required to confirm observed trends. I frame inconclusive results as future work, not as confirmed findings."

### Q4: "How do you know your ground truth angles are accurate?"
**Answer:** "Joint angles are derived from Vicon marker-based motion capture, the established gold standard in biomechanics with sub-millimeter accuracy. The dataset provides 25-joint 3D skeletons at 50 fps, fitted via the GHUM model to accurate 3D markers, multi-view image evidence, and body scans."

### Q5: "The dual-dataset strategy is well-known. Where's the novelty?"
**Answer:** "I do not claim the dual-dataset mixing strategy as a novel contribution. It is a methodological choice validated by the continual learning literature. My contribution is its application and empirical evaluation in the gym-exercise pose estimation domain, with Vicon-validated results showing [the specific outcome you measured]."

### Q6: "Does this actually work better than a human trainer?"
**Answer:** "That is not the claim. The research question asks whether the system achieves clinically *acceptable* accuracy and whether users perceive it as effective (SUS ≥ 70). PoseCoach is positioned as a supplementary tool for unsupervised training sessions, not a replacement for professional coaching."

---

## Part 5: Timeline Checklist

Before your defense, ensure you have completed:

- [ ] Ablation experiment (3 conditions) with results table filled in
- [ ] Statistical tests run and reported (Wilcoxon, effect sizes, CIs)
- [ ] Per-exercise-type breakdown of MAE results
- [ ] Latency benchmarks on specified hardware with percentile breakdown
- [ ] User study conducted (minimum 10 participants)
- [ ] SUS scores computed and reported
- [ ] RAG vs. visual-only comparison with paired statistical analysis
- [ ] AIGym comparison table included in Related Work chapter
- [ ] All anticipated examiner questions rehearsed with concise answers
- [ ] Limitations section written honestly (sample size, single-viewpoint test, etc.)
