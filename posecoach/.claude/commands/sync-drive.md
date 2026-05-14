# /sync-drive

Download the latest P01 outputs from Google Drive to your local project.

Run this after the Colab notebook completes successfully.

## Pre-Check
1. Confirm the Colab notebook ran to completion (all 4 eval JSON files exist in Drive)
2. Verify the 4 thesis metric gates passed — check the P01 summary cell output

## Files to Download from Google Drive

Open Google Drive at `MyDrive/GYMVISION AI/` and download:

| Drive Path | → Local Path |
|------------|-------------|
| `models/yolo_posecoach_v1.pt` | `posecoach/models/yolo_posecoach_v1.pt` |
| `models/yolo_posecoach_v1.onnx` | `posecoach/models/yolo_posecoach_v1.onnx` |
| `datasets/fit3d/angle_templates/angle_ranges_compact.json` | `posecoach/app/analysis/angle_ranges.json` |
| `data/eval/yolo_results.json` | `posecoach/data/eval/yolo_results.json` |
| `data/eval/latency_benchmark.json` | `posecoach/data/eval/latency_benchmark.json` |
| `data/eval/angle_mae_results.json` | `posecoach/data/eval/angle_mae_results.json` |
| `data/eval/rep_counter_validation.json` | `posecoach/data/eval/rep_counter_validation.json` |

## After Download — Verify Locally
```bash
# Check model files exist and are non-trivial size
ls -lh posecoach/models/
# Expected: yolo_posecoach_v1.pt (~6MB), yolo_posecoach_v1.onnx (~12MB)

# Check angle ranges loaded
python -c "import json; d=json.load(open('app/analysis/angle_ranges.json')); print(list(d.keys())[:5])"

# Check eval metrics pass gates
python -c "
import json, pathlib
for f in pathlib.Path('data/eval').glob('*.json'):
    print(f.name, json.loads(f.read_text()))
"
```

## Update .env
```
MODEL_PATH=models/yolo_posecoach_v1.onnx
```

## If Files Are Missing
- Run Colab notebook again from the failed step
- Check Drive storage quota (18GB Fit3D + frames fills up fast)
- Skip Fit3D if not downloaded yet — you can still proceed to P02 with a placeholder angle_ranges.json
