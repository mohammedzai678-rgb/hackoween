FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

# Install system dependencies for LightGBM (libgomp1) and curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (install CPU torch first to keep image lightweight)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements.txt

# Copy project source code and assets
COPY floodcast /app/floodcast
COPY backend /app/backend
COPY configs /app/configs
COPY docs /app/docs
COPY artifacts /app/artifacts
COPY data /app/data
COPY experiments /app/experiments
COPY README.md model_card.md solution.py /app/

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
