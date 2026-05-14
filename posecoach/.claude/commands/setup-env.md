# /setup-env

Set up the local development environment from scratch.

## System Requirements
- OS: WSL2 (Ubuntu 22 on Windows)
- GPU: NVIDIA RTX 3050 (CUDA 12.7, driver 566.07)
- Node: v18.19.1
- Python: 3.12.3 system (use pyenv for 3.11.9)

## Steps

### 1. Python Environment
```bash
# Install Python 3.11.9 via pyenv
pyenv install 3.11.9
cd posecoach
pyenv local 3.11.9
python --version  # must show 3.11.9

# Create virtualenv
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Environment Variables
```bash
cp .env.example .env
# Edit .env and set:
# DATABASE_URL=postgresql+asyncpg://postgres:dev@localhost:5432/posecoach
# REDIS_URL=redis://localhost:6379
# SECRET_KEY=$(openssl rand -hex 32)
# GEMINI_API_KEY=<from aistudio.google.com>
# OPENROUTER_API_KEY=<from openrouter.ai>
# MODEL_PATH=models/yolo_posecoach_v1.onnx
```

### 3. Docker Services (DB + Redis)
```bash
# Start only DB and Redis (not full stack yet)
docker-compose up -d db redis
docker-compose ps  # both should show "Up"
```

### 4. Database Setup
```bash
source venv/bin/activate
alembic upgrade head
# Should print: Running upgrade -> <revision>
```

### 5. Verify Backend Starts
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Visit http://localhost:8000/docs
# GET /health should return {"status": "ok"}
```

### 6. Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Visit http://localhost:5173
```

### 7. Model Files (After /sync-drive)
```bash
ls -lh models/
# Should show: yolo_posecoach_v1.pt + yolo_posecoach_v1.onnx
```

### 8. Kaggle Setup (For P01 reference)
```bash
mkdir -p ~/.kaggle
cp /path/to/kaggle.json ~/.kaggle/
chmod 600 ~/.kaggle/kaggle.json
```

## Verify Everything Works
```bash
# Full stack test
docker-compose up --build
pytest -x --timeout=30  # should pass (or skip if models not downloaded yet)
cd frontend && npx vitest run
```

## Troubleshooting
- `ModuleNotFoundError` → activate venv: `source venv/bin/activate`
- `alembic: no such table` → run `alembic upgrade head` with DB running
- `CUDA error` → use ONNX model for local dev, save GPU for Colab
- `Port 5432 in use` → `docker-compose down && docker-compose up -d db redis`
