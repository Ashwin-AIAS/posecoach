# TODO — Next Session (P03)

## Status so far
- P01 — Dataset Prep & Finetuning: DONE
- P02 — Infrastructure (Docker, FastAPI, DB): DONE
  - Last thing done: created `tests/conftest.py` + `tests/test_db.py`

## Before running tests (one-time setup)
Create the test database:
```bash
# Inside the postgres Docker container, or with psql installed:
createdb -U posecoach posecoach_test

# Then verify tests pass:
pytest tests/test_db.py -xvs
```

## Next: P03 — WebSocket + Inference Pipeline

### What to build
- `app/inference/websocket.py` — WebSocket endpoint that receives JPEG frames
- `app/inference/predictor.py` — YOLO26 inference (runs in executor, NOT on async loop)
- `app/inference/smoother.py` — Keypoint smoothing (EMA or one-euro filter)
- Wire into `app/main.py` router

### Critical rules for P03
- NEVER call NMS after model.predict() — YOLO26 is NMS-free (one-to-one head)
- NEVER pass end2end=False
- Use results[0].keypoints.xyn (normalized) — NOT .boxes
- Run inference in executor: await loop.run_in_executor(executor, lambda: model.predict(...))
- torch.cuda.empty_cache() every 100 frames

### How to start
Just say "run prompt 3" or "p03" and the p03-websocket-inference skill will guide it.
