# PoseCoach Backend — Python 3.11
# Build: docker build -t posecoach .
# Run:   docker-compose up backend

FROM python:3.11-slim

WORKDIR /app

# System dependencies for OpenCV, psycopg, and build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (cached layer — only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=10 \
      torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --timeout=300 --retries=10 -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

# Models and data directories
COPY models/ ./models/
COPY data/knowledge_base/ ./data/knowledge_base/
RUN mkdir -p data/chroma

# Build the RAG vector index so the chatbot has retrieval context in production.
# Runs once at image-build time; the resulting Chroma DB is baked into the image.
RUN python -m app.chatbot.ingest --reset

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Production: no --reload flag
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
