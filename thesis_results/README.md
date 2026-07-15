# Thesis Results

Written-up findings for the PoseCoach thesis, with every number traced to a
committed artifact. This folder is **hand-written analysis**; it is not generated
by a script (unlike `data/thesis/`, which `scripts/export_thesis_tables.py`
regenerates and which is gitignored).

## Contents

| Document | What it covers |
|----------|----------------|
| [`01_latency_lab_vs_deployed.md`](01_latency_lab_vs_deployed.md) | The lab-vs-deployed latency gap: why the system passes its <100 ms gate in the lab yet round-trips in 269 ms in production, the three levers falsified along the way, and the measured on-device alternative. Maps to the Evaluation chapter (§5) and the Discussion. |

## Thesis gate status (as of 2026-07-16)

| Metric | Target | Measured | Status | Artifact |
|--------|--------|----------|--------|----------|
| YOLO mAP@0.5 (pose) | > 0.70 | **0.9126** | PASS | `data/eval/yolo_results.json` |
| Form-score consistency | < 5% variance | **3.35%** | PASS | `data/eval/consistency_results.json` |
| Inference latency p95 | < 100 ms | **57.2 ms** (lab) | PASS — *but see 01* | `data/eval/latency_results.json` |
| Chatbot answer accuracy | ≥ 80% / 50 pairs | **not run** (`answers_evaluated: 0`) | BLOCKED — needs `GEMINI_API_KEY` in the run env | `data/eval/chatbot_results.json` |
| User study SUS | ≥ 70, n ≥ 10 | **n = 0** | NOT STARTED | `data/eval/sus_results.json` |

Retrieval recall (0.76) *is* already measured for the chatbot; only the
generation half is outstanding.

## A note on the artifacts

`data/eval/` is gitignored by default (it is regenerated output). The files cited
by these documents are deliberately **force-added** so the evidence travels with
the repo and every claim here is checkable:

- `data/eval/resolution_sweep_results.json`
- `data/eval/latency_probe_desktop_2026-07-15.json`
- `data/eval/ondevice_poc_iphone_2026-07-15.json`
- `data/eval/ondevice_poc_desktop_2026-07-15.json`

## Reproducing

```bash
# Baselines (the three passing gates)
python scripts/eval_yolo.py
python scripts/eval_latency.py
python scripts/eval_form_consistency.py

# Latency investigation, round 1 & 2 (local, needs data/calib_images/)
python notebooks/quantize_int8_local.py     # INT8-640 → collapses (documented)
python notebooks/resolution_sweep.py        # 320/448/512 vs 640 → all fail

# Rounds 3 & 4 are browser-side, run against the deployed Space:
#   https://ashwintaibu-posecoach.hf.space/?diag=1
#   → Settings → "Developer — Latency"     (round 3: RTT breakdown)
#   → Settings → "Developer — On-device"   (round 4: on-device + parity)
# Both have a "Copy JSON" button; paste the result into data/eval/ and force-add it.
```
