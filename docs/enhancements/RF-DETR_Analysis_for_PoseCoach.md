# RF-DETR for PoseCoach — Senior-Analyst Review

**Repo:** roboflow/rf-detr — *Real-Time SOTA Detection and Segmentation* (ICLR 2026)
**Paper:** arXiv:2511.09554 · **License:** Apache 2.0 (base) / PML 1.0 (XL+ "Plus")
**Reviewed:** 18 Jun 2026 · For: Ashwin (PoseCoach)

---

## TL;DR (read this first)

RF-DETR is an excellent model, but it is **not a pose estimator**. It does two things: **object detection** (bounding boxes) and **instance segmentation** (pixel masks). It has **no keypoint/skeleton head**. Your entire form-scoring pipeline runs on 17-point human keypoints from YOLO26-Pose — RF-DETR cannot produce those, so it **cannot replace your backbone**.

What it *can* do is sit **alongside** YOLO26-Pose and solve problems your pose model is bad at:

1. **Exercise / equipment verification** — detect the barbell, dumbbell, bench, kettlebell in frame and confirm the user is actually doing the exercise they selected. This is exactly your P12–P13 "exercise verification" feature, done properly with a vision model instead of heuristics.
2. **Robust person detection / subject selection** in messy gym scenes (mirrors, bystanders).
3. **Segmentation-based privacy** — silhouette the user, blur everything else.

And one strategic point that matters more than any feature, given your **startup pivot**:

4. **Licensing.** YOLO (Ultralytics) is **AGPL-3.0** — a serious problem for a closed-source commercial product. RF-DETR's base models are **Apache 2.0**. This is the single most important thing in this report.

**Bottom line:** Don't swap your backbone. Consider RF-DETR as a *second, optional* model for equipment/exercise verification — and treat its Apache-2.0 license as a strategic asset to study now, before you build a business on AGPL code.

---

## 1. What RF-DETR actually is

RF-DETR is a **detection transformer** (DETR-family) built on a **DINOv2** vision-transformer backbone, developed by Roboflow. It is the current state-of-the-art on COCO for the real-time accuracy/latency trade-off, and it is explicitly **designed to be fine-tuned** on your own small dataset (its standout result is on RF100-VL, a benchmark of 100 real-world custom datasets — i.e. exactly the "I have a few hundred labelled gym images" situation).

Two task heads, two model families:

| Family | Output | Sizes | Best base license |
|---|---|---|---|
| Detection | Bounding boxes + class | N, S, M, L (Apache) · XL, 2XL (PML/paid) | Apache 2.0 |
| Segmentation | Pixel masks + class | N → 2XL | Apache 2.0 (all sizes) |

**There is no pose/keypoint variant.** This is the defining fact for your use case.

### How it differs from YOLO architecturally
- **Transformer (DETR), not CNN.** No anchors, end-to-end set prediction. Like your YOLO26, it is effectively **NMS-free** at inference — so the mental model you already have ("don't run NMS, the head handles it") carries over.
- **DINOv2 backbone** gives strong transfer learning, which is why it fine-tunes well on small custom datasets — relevant if you ever label gym equipment yourself.
- **Heavier.** Even the Nano detection model is **30.5M params** vs YOLO26-N's 2.6M. RF-DETR buys accuracy with size.

---

## 2. The benchmark picture (from the repo, T4 GPU, TensorRT FP16)

### Detection — RF-DETR vs your YOLO26
| Model | COCO AP50:95 | Latency (ms) | Params (M) | License |
|---|---|---|---|---|
| RF-DETR-N | 48.4 | 2.3 | 30.5 | Apache 2.0 |
| RF-DETR-S | 53.0 | 3.5 | 32.1 | Apache 2.0 |
| RF-DETR-M | 54.7 | 4.4 | 33.7 | Apache 2.0 |
| YOLO26-N | 40.3 | 1.7 | 2.6 | AGPL-3.0 |
| YOLO26-S | 47.7 | 2.6 | 9.4 | AGPL-3.0 |
| YOLO26-M | 52.5 | 4.4 | 20.1 | AGPL-3.0 |

**How to read this:** RF-DETR is markedly more accurate at a comparable latency *on a GPU with TensorRT*. But notice what's missing — there are **no CPU/ONNX latency numbers** in the RF-DETR README. Your production inference runs **ONNX on CPU (Render)**. A 30M-param transformer on CPU will be far slower than your 2.9M YOLO26-pose model. RF-DETR is a **GPU model** in practice (your Modal GPU tier, not your Render API).

### Segmentation
RF-DETR-Seg beats YOLO/YOLO26 segmentation across the board on COCO mask AP — genuinely SOTA. Relevant only if you want pixel masks (privacy blur, body silhouette), not for form scoring.

---

## 3. Where RF-DETR genuinely fits in PoseCoach

Ranked by value-to-effort.

### ★★★ Use case 1 — Exercise & equipment verification (the strong one)
Your CLAUDE.md says the model is `nc=1` (person only) by design — exercise type comes from the **UI dropdown**, and P12–P13 added "exercise verification + stricter scoring." Right now, if a user selects "squat" but films a bicep curl, your scorer has limited ability to catch the mismatch from keypoints alone.

A **small RF-DETR detection model fine-tuned on gym equipment** (`barbell`, `dumbbell`, `kettlebell`, `bench`, `pull-up bar`, `none/bodyweight`) gives you a clean second signal:
- User selects "bench press" → RF-DETR should see a `barbell` + `bench`. If it sees a `dumbbell`, surface: *"Looks like dumbbells — did you mean dumbbell press?"*
- Distinguishes barbell vs dumbbell vs bodyweight variants of the same movement — something keypoints alone can't reliably do.

This is the cleanest, most defensible addition. It maps directly to an existing feature you already decided was worth building, and equipment is a much easier detection target than fine-grained form.

**Cost:** you'd need a labelled gym-equipment dataset (Roboflow Universe has several you could fine-tune on) and a place to run a second model. Run it **occasionally** (once per set, not per frame) so latency barely matters.

### ★★ Use case 2 — Primary-subject selection in cluttered scenes
Gyms have mirrors, bystanders, and reflections. Your pipeline takes `results[0].keypoints` (max 300 persons). A detector that reliably picks the *foreground subject* (largest/most-centred box, ignoring mirror reflections) can make your "who are we scoring" logic more robust. YOLO26-Pose already does person detection, so this is an incremental robustness gain, not a new capability — **lower priority**.

### ★★ Use case 3 — Segmentation for privacy (aligns with your GDPR stance)
Your privacy rules are strict: frames never hit disk, only derived keypoints stored. RF-DETR-Seg could **segment the person and blur/black-out the background in-browser before any frame is sent** — a strong privacy story ("we never even transmit your room"). Nice for a startup trust narrative, but it's heavy to run client-side and isn't required by your current architecture. **Future/marketing feature, not core.**

### ✗ Non-use case — Replacing YOLO26-Pose
Worth stating explicitly so it doesn't tempt you later: RF-DETR produces **boxes and masks, not 17 keypoints**. Your `form_scorer.py`, `ANGLE_RANGES`, rep counter, and EMA smoothers all consume keypoints. RF-DETR feeds none of that. There is no migration path here.

---

## 4. The licensing angle — most important for the startup pivot

Your memory notes PoseCoach is **no longer a thesis** and is heading toward a **personal tool → startup**. That changes the calculus on your current stack:

- **Ultralytics YOLO (v8/11/26) is AGPL-3.0.** AGPL is a strong copyleft: if you build a commercial, network-served product on it and don't open-source your *entire* application, you are either non-compliant or you must buy an **Ultralytics Enterprise license** (a recurring commercial fee). For a SaaS, AGPL is a real liability, not a footnote.
- **RF-DETR base models (N/S/M/L detection + all segmentation sizes) are Apache 2.0** — permissive, commercial-friendly, no copyleft, no fee. (Only the XL/2XL "Plus" models are under the paid PML 1.0 license — avoid those and you stay clean.)

**Implication:** RF-DETR doesn't solve your *pose* licensing problem (it has no pose head), but it flags the issue. For a startup you will eventually want a **permissively licensed pose model** too. Apache/BSD/MIT options to research: **ViTPose**, **MMPose (RTMPose / RTMO)**, **MediaPipe Pose**. RTMPose in particular is fast, real-time, and Apache-2.0 — the natural "commercial-safe" replacement for YOLO26-Pose when you outgrow the thesis prototype.

This is the highest-leverage takeaway in the whole review: **start de-risking the AGPL dependency before you have paying users.**

---

## 5. Architectural & cost reality check

If you add RF-DETR as a second model, respect these constraints (they line up with your existing CLAUDE.md rules):

- **Don't run it per-frame on CPU.** It's a transformer; CPU ONNX will be slow. Run equipment verification **once per set / on demand**, on your **Modal GPU** path, not the Render CPU API.
- **Load once, run in executor** — same lifespan + `run_in_executor` pattern you already use for YOLO26. Don't instantiate per request.
- **It uses `supervision` + Roboflow `inference`** as its ecosystem. That's clean Python and fits FastAPI, but it's another dependency tree to pin and another model file to ship.
- **Two models = two latency budgets.** Your current end-to-end budget (~58ms, target <100ms p95) is for the pose path. Keep RF-DETR off the hot loop entirely so it never competes with that budget.
- **You'd need labelled data.** Equipment detection only works after fine-tuning. Budget time for dataset assembly (Roboflow Universe gym datasets are a fast start) + a Colab fine-tune run — which fits your "training on Colab only" rule.

---

## 6. Recommendation

1. **Do NOT replace YOLO26-Pose.** Different task. No keypoints. No migration path.
2. **Prototype RF-DETR (Nano or Small) as an equipment/exercise verifier** — a once-per-set GPU call that cross-checks the user's selected exercise. This upgrades your existing P12–P13 verification from heuristic to vision-based, and equipment is an easy, high-confidence target. Highest value-to-effort.
3. **Treat the Apache-2.0 license as the real signal.** Open a parallel track to evaluate **RTMPose / ViTPose (Apache)** as the eventual commercial-safe replacement for AGPL YOLO26-Pose. You don't have to act now, but know the exit before you monetize.
4. **Park segmentation-for-privacy** as a future trust/marketing feature, not core work.

### Suggested next step if you want to try it
A 1-hour spike: grab a gym-equipment dataset from Roboflow Universe, fine-tune `RFDETRNano` in the official Colab notebook, and run it on 10 of your own workout clips to see whether barbell/dumbbell/bench detection is reliable enough to gate exercise selection. If yes, wire it as an on-demand `/verify-exercise` call on the Modal GPU path.

---

## Key sources
- RF-DETR repo & benchmarks: https://github.com/roboflow/rf-detr
- Paper (NAS for Real-Time Detection Transformers): https://arxiv.org/abs/2511.09554
- Docs: https://rfdetr.roboflow.com
- Fine-tune Colab: https://colab.research.google.com/github/roboflow-ai/notebooks/blob/main/notebooks/how-to-finetune-rf-detr-on-detection-dataset.ipynb
- Commercial-safe pose alternatives to research: RTMPose / RTMO (MMPose, Apache-2.0), ViTPose, MediaPipe Pose
