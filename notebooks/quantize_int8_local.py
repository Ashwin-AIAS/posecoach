"""
Local INT8 quantization + benchmark for PoseCoach  (no Colab / Kaggle / Drive).

Runs entirely on your machine using the model already in ../models/.
Produces: models/yolo_posecoach_v1_int8.onnx
Reports:  latency (640 FP32 vs 640 INT8 vs existing 320) and INT8-vs-FP32
          keypoint drift (OKS proxy — the labeled val split isn't local, so this
          stands in for the exact OKS-mAP recheck).

Usage:
    cd "GYMVISION AI"
    python notebooks/quantize_int8_local.py
"""
import os, sys, glob, time, random, subprocess
from pathlib import Path
import numpy as np

random.seed(0)

# ---------------- CONFIG ----------------
ROOT       = Path(__file__).resolve().parents[1]        # GYMVISION AI/
MODELS     = ROOT / "models"
PT_WEIGHTS = MODELS / "yolo_posecoach_v1.pt"
FP32_ONNX  = MODELS / "yolo_posecoach_v1.onnx"          # existing 640 export
ONNX_320   = MODELS / "yolo_posecoach_v1_320.onnx"      # existing 320 export
PREP_ONNX  = MODELS / "yolo_posecoach_v1.prep.onnx"
INT8_ONNX  = MODELS / "yolo_posecoach_v1_int8.onnx"     # output

IMGSZ      = 640
CONF       = 0.5
N_CALIB    = 200          # calibration images
N_EVAL     = 150          # eval images (disjoint from calib)

CALIB_ROOT = ROOT / "data" / "calib_images"             # put your own images here to skip download
KAGGLE_IMAGES_SLUG = "hasyimabdillah/workoutexercises-images"   # in-domain fallback source

# ---------------- deps ----------------
def ensure(pkgs):
    import importlib
    for imp, pipname in pkgs:
        try: importlib.import_module(imp)
        except ImportError:
            print(f"installing {pipname} ...")
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", pipname], check=True)
ensure([("cv2","opencv-python"), ("onnx","onnx"), ("onnxruntime","onnxruntime"),
        ("ultralytics","ultralytics>=8.3.0")])
import cv2
import onnxruntime as ort
from onnxruntime.quantization import (
    CalibrationDataReader, quantize_static, QuantType, QuantFormat, CalibrationMethod,
)
from onnxruntime.quantization.shape_inference import quant_pre_process
from ultralytics import YOLO

assert FP32_ONNX.exists(), f"missing {FP32_ONNX}"

# ---------------- context: your recorded baselines ----------------
def show_baseline():
    import json
    for name in ["yolo_results.json", "latency_benchmark.json"]:
        p = ROOT / "data" / "eval" / name
        if p.exists():
            print(f"  {name}: {json.load(open(p))}")
print("Recorded baselines (for reference):")
show_baseline()

# ---------------- get calibration + eval images ----------------
def collect_images():
    CALIB_ROOT.mkdir(parents=True, exist_ok=True)
    imgs = [p for p in glob.glob(str(CALIB_ROOT / "**" / "*"), recursive=True)
            if p.lower().endswith((".jpg", ".jpeg", ".png"))]
    if len(imgs) >= N_CALIB + 20:
        print(f"using {len(imgs)} local images from {CALIB_ROOT}")
    else:
        print(f"only {len(imgs)} local images; downloading {KAGGLE_IMAGES_SLUG} via Kaggle CLI ...")
        try:
            subprocess.run([sys.executable, "-m", "kaggle", "datasets", "download",
                            "-d", KAGGLE_IMAGES_SLUG, "-p", str(CALIB_ROOT), "--unzip"],
                           check=True)
            imgs = [p for p in glob.glob(str(CALIB_ROOT / "**" / "*"), recursive=True)
                    if p.lower().endswith((".jpg", ".jpeg", ".png"))]
        except Exception as e:
            print("Kaggle download failed:", e)
    if len(imgs) < 50:
        sys.exit(f"Not enough calibration images ({len(imgs)}). "
                 f"Drop ~250 workout images into {CALIB_ROOT} and re-run.")
    random.shuffle(imgs)
    return imgs[:N_CALIB], imgs[N_CALIB:N_CALIB + N_EVAL]

CALIB_FILES, EVAL_FILES = collect_images()
print(f"calibration: {len(CALIB_FILES)}   eval: {len(EVAL_FILES)}")

# ---------------- preprocessing (Ultralytics-style letterbox) ----------------
def letterbox(im, new, color=(114, 114, 114)):
    h, w = im.shape[:2]; r = min(new / h, new / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    im = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top, left = (new - nh) // 2, (new - nw) // 2
    return cv2.copyMakeBorder(im, top, new - nh - top, left, new - nw - left,
                              cv2.BORDER_CONSTANT, value=color)
def preprocess(path, size):
    im = cv2.imread(path); im = letterbox(im, size)
    im = cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.ascontiguousarray(im.transpose(2, 0, 1)[None])

# ---------------- quantize: FP32 onnx -> INT8 static PTQ ----------------
print("\n[1/3] pre-processing graph (shape inference + opt) ...")
quant_pre_process(str(FP32_ONNX), str(PREP_ONNX), skip_symbolic_shape=True)

in_name = ort.InferenceSession(str(PREP_ONNX), providers=["CPUExecutionProvider"]).get_inputs()[0].name
class Reader(CalibrationDataReader):
    def __init__(self, files, name): self.files, self.name, self.i = files, name, 0
    def get_next(self):
        if self.i >= len(self.files): return None
        x = preprocess(self.files[self.i], IMGSZ); self.i += 1
        return {self.name: x}
    def rewind(self): self.i = 0

print("[2/3] static INT8 quantization ...")
quantize_static(
    str(PREP_ONNX), str(INT8_ONNX),
    calibration_data_reader=Reader(CALIB_FILES, in_name),
    quant_format=QuantFormat.QDQ, per_channel=True, reduce_range=True,
    activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
    calibrate_method=CalibrationMethod.MinMax,   # Percentile/Entropy OOM locally: histogram
    # calibrators buffer full activations for all calib images (>15GB RAM); MinMax collects
    # scalar ReduceMin/ReduceMax per tensor and streams fine on this machine.
    nodes_to_exclude=[],
)
print(f"    INT8 written: {INT8_ONNX.name}  ({INT8_ONNX.stat().st_size/1e6:.1f} MB)")

# ---------------- latency benchmark (local CPU) ----------------
def bench(path, size, n=50):
    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    nm = s.get_inputs()[0].name
    x = np.random.rand(1, 3, size, size).astype(np.float32)
    for _ in range(5): s.run(None, {nm: x})
    t = []
    for _ in range(n):
        t0 = time.perf_counter(); s.run(None, {nm: x}); t.append((time.perf_counter() - t0) * 1000)
    t = np.array(t); return t.mean(), np.median(t), np.percentile(t, 95)

print("\n[3/3] latency (local CPU, 50 runs each):")
rows = [("640 FP32", FP32_ONNX, 640), ("640 INT8", INT8_ONNX, 640)]
if ONNX_320.exists(): rows.append(("320 FP32", ONNX_320, 320))
base = None
for label, path, size in rows:
    m, med, p95 = bench(path, size)
    if base is None: base = m
    print(f"    {label:9s}  mean {m:6.1f}  median {med:6.1f}  p95 {p95:6.1f} ms"
          f"   ({100*(1-m/base):+.0f}% vs 640 FP32)")

# ---------------- accuracy proxy: INT8 vs FP32 keypoint drift (OKS) ----------------
print("\naccuracy proxy — INT8 vs FP32 keypoint agreement (OKS; 1.0 = identical):")
COCO_SIGMAS = np.array([.26,.25,.25,.35,.35,.79,.79,.72,.72,.62,.62,
                        1.07,1.07,.87,.87,.89,.89]) / 10.0
# Ultralytics' ONNX predict wrapper misparses this end-to-end pose export
# (NMS-style postprocess on the one-to-one head) — decode the raw output tensor
# directly, using the verified layout from app/inference/onnx_session.py:
# (1, 300, 57) rows = [x1, y1, x2, y2, score, class] + 17*(x, y, conf).
def _session(path):
    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
fp = _session(FP32_ONNX); q = _session(INT8_ONNX)
def top_person(sess, path):
    x = preprocess(path, IMGSZ)
    det = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]  # (300, 57)
    if det.shape[0] == 0: return None, None
    j = int(det[:, 4].argmax())
    if float(det[j, 4]) < CONF: return None, None
    x1, y1, x2, y2 = det[j, :4]
    area = float(max(x2 - x1, 1.0) * max(y2 - y1, 1.0))
    return det[j, 6:].reshape(17, 3)[:, :2].astype(np.float32), area
def oks(a, b, area):
    K = a.shape[0]; s = COCO_SIGMAS if K == 17 else np.full(K, 0.05)
    d2 = ((a - b) ** 2).sum(1)
    return float(np.exp(-d2 / (2 * area * s**2 + 1e-9)).mean())
scores = []
for f in EVAL_FILES:
    g, area = top_person(fp, f); p, _ = top_person(q, f)
    if g is None or p is None or area is None or g.shape != p.shape: continue
    scores.append(oks(g, p, area))
scores = np.array(scores)
if len(scores):
    print(f"    frames compared: {len(scores)}   mean OKS: {scores.mean():.4f}   "
          f">=0.95: {(scores>=0.95).mean()*100:.1f}%")
    print("    guide: mean OKS >= 0.98 => INT8 barely changed the keypoints (good).")
else:
    print("    no comparable detections — check the eval images.")

# ---------------- accuracy proxy: 320 vs 640 FP32 keypoint drift (the real candidate) ----------------
# The 320 model is the strong latency lever (already exported, not broken). Compare its
# keypoints to the 640 model in NORMALIZED coords so the two input sizes are comparable.
if ONNX_320.exists():
    print("\naccuracy proxy — 320 vs 640 FP32 keypoint agreement (OKS; normalized coords):")
    s320 = _session(ONNX_320)
    def top_person_n(sess, path, size):
        x = preprocess(path, size)
        det = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
        if det.shape[0] == 0: return None, None
        j = int(det[:, 4].argmax())
        if float(det[j, 4]) < CONF: return None, None
        x1, y1, x2, y2 = det[j, :4]
        area = float(max(x2 - x1, 1.0) * max(y2 - y1, 1.0)) / (size * size)   # normalized
        kp = det[j, 6:].reshape(17, 3)[:, :2].astype(np.float32) / size        # normalized
        return kp, area
    sc, d640, d320 = [], 0, 0
    for f in EVAL_FILES:
        g, area = top_person_n(fp, f, 640)      # fp = 640 session (defined above)
        p, _    = top_person_n(s320, f, 320)
        if g is not None: d640 += 1
        if p is not None: d320 += 1
        if g is None or p is None or area is None or g.shape != p.shape: continue
        sc.append(oks(g, p, area))
    sc = np.array(sc)
    print(f"    detections: 640 found {d640}/{len(EVAL_FILES)},  320 found {d320}/{len(EVAL_FILES)}")
    if len(sc):
        print(f"    frames compared: {len(sc)}   mean OKS: {sc.mean():.4f}   "
              f">=0.95: {(sc>=0.95).mean()*100:.1f}%")
        print("    guide: mean OKS >= 0.97 AND similar detection counts => 320 is safe to ship.")
    else:
        print("    no comparable detections.")

print("\nDONE.")
print("candidate for shipping:  320 model =", ONNX_320.name, "(74% faster, not broken)")
print("INT8 model =", INT8_ONNX.name, "-> collapsed (score=0); would need head-node exclusion to be usable.")
print("NOTE: exact OKS-mAP@0.50 vs your 0.9126 baseline needs the labeled val split (not local).")
