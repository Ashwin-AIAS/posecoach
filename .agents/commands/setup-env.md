# /setup-env

Set up the local development environment from scratch.

## Steps
1. Python 3.11.9 via pyenv + `python -m venv venv` + `pip install -r requirements.txt`
2. `cp .env.example .env` and set `POSTGRES_URL`, `REDIS_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `MODEL_PATH=models/yolo_posecoach_v1.onnx`
3. `docker-compose up -d db redis`
4. `alembic upgrade head`
5. `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
6. `cd frontend && npm install && npm run dev`
