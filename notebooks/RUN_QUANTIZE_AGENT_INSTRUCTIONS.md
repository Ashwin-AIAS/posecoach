# Agent Task — Run `quantize_int8_colab.ipynb` to completion (COLAB)

## Why Colab (read first)
The fine-tuned weights and the `yolo_pose` train/val split live on **Google Drive**
(`/content/drive/MyDrive/GYMVISION AI/...`). Only **Colab** can mount Drive — a
Kaggle kernel cannot. So this notebook must run on a **Colab runtime**, the same way
the P01 training notebook ran.

## Objective
Execute `quantize_int8_colab.ipynb` cell-by-cell on a Colab runtime until **every cell
completes without error** and the final results are produced. On any error, diagnose,
fix that cell, and re-run — repeat until done. Report exact numbers at the end.

## Connect the Colab kernel FIRST (Antigravity Colab extension)
This machine has the Google **Colab** extension installed. Execute the notebook on the
**Colab kernel**, NOT the local terminal/PowerShell (last run failed because everything
was driven through local shell).
1. Open `quantize_int8_colab.ipynb`.
2. Select Kernel → **Colab → Auto Connect**; sign in with the Google account that owns
   the `GYMVISION AI` Drive folder.
3. Set the Colab runtime to **T4 GPU**.
4. Run every cell **through this Colab kernel**. Do not use the terminal to run the
   notebook or to hunt for files — the files are on Drive, reachable only from Colab.

## MUST verify you are actually in Colab (do this first)
Run:
```python
import google.colab  # must succeed
import torch; print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE")
```
- If `import google.colab` **fails**, you are NOT on a Colab runtime (you're on a local
  kernel). **STOP and tell the user** — do not attempt to run the notebook locally and
  do not try to fake the Drive paths. Nothing will work without Drive.
- If GPU is `NONE`, ask the user to set Runtime → Change runtime type → **T4 GPU**.

## Environment setup
- In cell **[2]** keep `ENV = "colab"`.
- Cell [2] runs `drive.mount('/content/drive')` — this needs the user to authorize Drive
  access in the popup. Wait for the mount to finish before continuing.

## Expected paths (already set by the notebook's colab branch — just confirm they exist)
- Weights: `/content/drive/MyDrive/GYMVISION AI/models/yolo_posecoach_v1.pt`
  (fallback `.../models/runs/posecoach_v1/weights/best.pt`)
- Val split: `/content/drive/MyDrive/GYMVISION AI/datasets/yolo_pose/val/images` (+ `/labels`)
- Train frames (calibration source): `.../datasets/yolo_pose/train/images`
- Outputs go next to the weights in `.../models/` (Drive is writable in Colab).

If, after mounting, the weights or val split are **not** at those paths, list what IS in
`/content/drive/MyDrive/GYMVISION AI/models` and `.../datasets`, then STOP and report —
do not invent a model or a val set.

## Autonomy loop (strict)
1. Run the next cell.
2. Success → next cell.
3. Error → read the full traceback, apply the **smallest** fix to that cell, re-run.
4. Repeat until it passes, then continue. Up to 5 fixes per cell; if still failing, stop
   and show the traceback + everything tried.
5. When all cells pass → produce the Final Report (below).
Never skip a cell, never loosen/delete the accuracy gate, never fabricate numbers.

## Troubleshooting playbook
- `No module named 'google.colab'` → you are not in Colab (see MUST-verify above); STOP.
- Drive mount hangs → the user hasn't approved the auth popup; wait / re-run cell [2].
- `AssertionError` on weights/val → confirm the Drive paths above; list the folders; STOP if truly absent.
- Export fails on `simplify=True` (needs onnxslim) → `!pip install onnxslim`, or set `simplify=False` in cell [6].
- `.val()` returns mAP = 0 → val **labels** missing/mismatched; check `.../yolo_pose/val/labels/*.txt` have 56 fields/line.
- Ultralytics can't load the INT8 QDQ ONNX in cell [9] → fallback to the INT8-vs-FP32 OKS proxy and say so; never skip the accuracy check.
- Calibration slow / RAM pressure in cell [8] → lower `N_CALIB` to 150.

## If the accuracy gate FAILS
Apply in order, re-running cells [8]→[9]:
1. `calibrate_method = CalibrationMethod.Entropy`
2. exclude the last keypoint-head Conv layers via `nodes_to_exclude` (see the notebook's bottom comment).
If it still fails, report FAIL with the real numbers — that is a valid result.

## Final Report (produce when all cells pass)
```
NOTEBOOK: quantize_int8_colab.ipynb — status: COMPLETED (Colab, GPU: <name>)
weights used:            <path>
calibration frames:      <n>
FP32 OKS-mAP@0.50:       <x.xxxx>   (mAP@0.50:0.95: <x.xxxx>)
INT8 OKS-mAP@0.50:       <x.xxxx>   (mAP@0.50:0.95: <x.xxxx>)
accuracy drop:           <x.xxxx> (<x.x>%)
ACCURACY GATE (<=2% and >=0.75):  PASS / FAIL
FP32 latency (mean/median/p95 ms): <..>
INT8 latency (mean/median/p95 ms): <..>   speedup: <x>%
INT8 artifact path:      <.../models/yolo_posecoach_v1.int8.onnx>
fixes applied: <bullets, or "none">
```
Also paste the raw stdout of cells [9] and [10] verbatim.
```
```
