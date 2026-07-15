"""
Resolution sweep for PoseCoach — find the lowest input size that keeps 640's accuracy.

Production runs 640 (models/yolo_posecoach_v1.onnx) for tracking quality; 320 was rejected
(too lossy). This tests the middle ground (448, 512) against 640 on latency AND keypoint
agreement, so we can pick the smallest size that preserves accuracy.

No INT8. Runs locally. Reuses images in data/calib_images/ (downloaded earlier).

    cd "GYMVISION AI"
    python notebooks/resolution_sweep.py
"""
import sys, glob, time, random, subprocess, shutil, json, platform
from pathlib import Path
import numpy as np
random.seed(0)

ROOT   = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
PT     = MODELS / "yolo_posecoach_v1.pt"
IMG_DIR = ROOT / "data" / "calib_images"
CONF   = 0.5
N_EVAL = 150
REF    = 640                      # accuracy anchor = production resolution
SIZES  = [320, 448, 512, 640]     # 320 & 640 already exported; 448/512 exported below

def ensure(pkgs):
    import importlib
    for imp, name in pkgs:
        try: importlib.import_module(imp)
        except ImportError:
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", name], check=True)
ensure([("cv2","opencv-python"), ("onnxruntime","onnxruntime"), ("ultralytics","ultralytics>=8.3.0")])
import cv2, onnxruntime as ort
from ultralytics import YOLO

# ---- model files per size (export 448/512 from the .pt WITHOUT clobbering 640) ----
def onnx_for(size):
    if size == 640: return MODELS / "yolo_posecoach_v1.onnx"
    if size == 320: return MODELS / "yolo_posecoach_v1_320.onnx"
    out = MODELS / f"yolo_posecoach_v1_{size}.onnx"
    if out.exists(): return out
    assert PT.exists(), f"need {PT} to export {size}"
    tmp_pt = MODELS / f"_tmp_{size}.pt"; shutil.copy(PT, tmp_pt)      # unique stem => no clobber
    try:
        p = YOLO(str(tmp_pt)).export(format="onnx", imgsz=size, simplify=True, opset=17, dynamic=False)
    except Exception:
        p = YOLO(str(tmp_pt)).export(format="onnx", imgsz=size, simplify=False, opset=17, dynamic=False)
    shutil.move(str(p), str(out))
    try: tmp_pt.unlink(missing_ok=True)
    except OSError: pass  # OneDrive/AV can hold a lock on fresh files; leftover tmp is harmless
    print(f"  exported {size}: {out.name}")
    return out

# ---- preprocessing (Ultralytics-style letterbox) ----
def letterbox(im, new, color=(114,114,114)):
    h, w = im.shape[:2]; r = min(new/h, new/w)
    nh, nw = int(round(h*r)), int(round(w*r))
    im = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top, left = (new-nh)//2, (new-nw)//2
    return cv2.copyMakeBorder(im, top, new-nh-top, left, new-nw-left, cv2.BORDER_CONSTANT, value=color)
def preprocess(path, size):
    im = cv2.imread(path); im = letterbox(im, size)
    im = cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32)/255.0
    return np.ascontiguousarray(im.transpose(2,0,1)[None])

COCO_SIGMAS = np.array([.26,.25,.25,.35,.35,.79,.79,.72,.72,.62,.62,
                        1.07,1.07,.87,.87,.89,.89]) / 10.0
def top_person_n(sess, path, size):
    x = preprocess(path, size)
    det = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]   # (300, 57)
    if det.shape[0] == 0: return None, None
    j = int(det[:,4].argmax())
    if float(det[j,4]) < CONF: return None, None
    x1,y1,x2,y2 = det[j,:4]
    area = float(max(x2-x1,1.0)*max(y2-y1,1.0))/(size*size)
    kp = det[j,6:].reshape(17,3)[:,:2].astype(np.float32)/size
    return kp, area
def oks(a, b, area):
    d2 = ((a-b)**2).sum(1)
    return float(np.exp(-d2/(2*area*COCO_SIGMAS**2 + 1e-9)).mean())

def bench(path, size, n=50):
    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    nm = s.get_inputs()[0].name; x = np.random.rand(1,3,size,size).astype(np.float32)
    for _ in range(5): s.run(None, {nm:x})
    t = [ (lambda t0:(s.run(None,{nm:x}),(time.perf_counter()-t0)*1000)[1])(time.perf_counter()) for _ in range(n) ]
    t = np.array(t); return t.mean(), np.percentile(t,95)

# ---- images ----
imgs = [p for p in glob.glob(str(IMG_DIR/"**"/"*"), recursive=True)
        if p.lower().endswith((".jpg",".jpeg",".png"))]
if len(imgs) < 50: sys.exit(f"Need images in {IMG_DIR} (run quantize_int8_local.py once to fetch them).")
random.shuffle(imgs); EVAL = imgs[:N_EVAL]
print(f"eval images: {len(EVAL)}\n")

# ---- prepare models + reference sessions ----
print("preparing models ...")
files = {s: onnx_for(s) for s in SIZES}
sess  = {s: ort.InferenceSession(str(files[s]), providers=["CPUExecutionProvider"]) for s in SIZES}

# ---- latency ----
print("\nlatency (local CPU, 50 runs):")
lat, lat_p95 = {}, {}
base = bench(files[640], 640)[0]
for s in SIZES:
    m, p95 = bench(files[s], s); lat[s] = m; lat_p95[s] = p95
    print(f"  {s:>3}px  mean {m:6.1f}  p95 {p95:6.1f} ms   ({100*(1-m/base):+.0f}% vs 640)")

# ---- accuracy proxy vs 640 ----
print("\nkeypoint agreement vs 640 (OKS, normalized) + detection parity:")
ref = sess[REF]
det_ref = 0
per_size = {s: {"oks":[], "det":0} for s in SIZES if s != REF}
# precompute ref detections
ref_kp = {}
for f in EVAL:
    g, area = top_person_n(ref, f, REF)
    if g is not None: det_ref += 1; ref_kp[f] = (g, area)
for s in SIZES:
    if s == REF: continue
    for f in EVAL:
        p, _ = top_person_n(sess[s], f, s)
        if p is not None: per_size[s]["det"] += 1
        if f in ref_kp and p is not None and p.shape == ref_kp[f][0].shape:
            per_size[s]["oks"].append(oks(ref_kp[f][0], p, ref_kp[f][1]))
print(f"  640 (ref): detected {det_ref}/{len(EVAL)}")
best = None
for s in SIZES:
    if s == REF: continue
    o = np.array(per_size[s]["oks"]); d = per_size[s]["det"]
    mo = o.mean() if len(o) else 0.0
    ok = mo >= 0.97 and d >= 0.97*det_ref
    print(f"  {s:>3}px: detected {d}/{len(EVAL)}  mean OKS {mo:.4f}  >=0.95 {100*(o>=0.95).mean() if len(o) else 0:.0f}%"
          f"   {'PASS' if ok else 'fail'}")
    if ok and (best is None or s < best): best = s

# ---- persist results (machine-readable) ----
out_json = ROOT / "data" / "eval" / "resolution_sweep_results.json"
out_json.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "machine": platform.node(), "platform": platform.platform(),
    "n_eval": len(EVAL), "conf": CONF, "ref": REF,
    "latency_ms_mean": {str(s): round(lat[s], 2) for s in SIZES},
    "latency_ms_p95": {str(s): round(lat_p95[s], 2) for s in SIZES},
    "detections": {**{str(REF): det_ref},
                   **{str(s): per_size[s]["det"] for s in SIZES if s != REF}},
    "mean_oks_vs_640": {str(s): (round(float(np.mean(per_size[s]["oks"])), 4)
                                 if per_size[s]["oks"] else None)
                        for s in SIZES if s != REF},
    "pass_criteria": {"mean_oks": 0.97, "detection_parity": 0.97},
    "best": best,
}
out_json.write_text(json.dumps(payload, indent=2))
print(f"\nresults written: {out_json}")

print("\n--- recommendation ---")
if best:
    print(f"Smallest size that preserves 640 accuracy: {best}px  "
          f"({100*(1-lat[best]/base):.0f}% faster than 640).  Candidate to ship.")
else:
    print("No size below 640 preserves accuracy (OKS>=0.97 + detection parity).")
    print("=> model-resolution is NOT a safe latency lever here. Next: repair INT8 on 640")
    print("   (exclude the head nodes), or attack latency at the infra layer (Space tier,")
    print("   backpressure/drop-latest, or on-device inference).")
print("\nNOTE: exact OKS-mAP vs the 0.9126 baseline still needs the labeled val split.")
