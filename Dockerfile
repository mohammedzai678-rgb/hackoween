# Stage 1: Build Next.js frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=/api/v1
RUN mkdir -p public && npm run build

# Stage 2: Final runtime container with Python 3.12 + Node.js 20
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PORT=7860 \
    INTERNAL_API_URL=http://127.0.0.1:8000/api/v1

# Install system dependencies + Node.js 20 + Ollama Local LLM
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    ca-certificates \
    procps \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://ollama.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# Install Python ML dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements.txt

# Pre-cache Qwen 2.5 (1.5B) model directly in the Docker image for instant offline startup
RUN (ollama serve > /dev/null 2>&1 &) \
    && sleep 3 \
    && ollama pull qwen2.5:1.5b \
    && pkill -f "ollama" || true

# Copy Backend, Configs, Docs & ML Assets
COPY floodcast /app/floodcast
COPY backend /app/backend
COPY configs /app/configs
COPY docs /app/docs
COPY artifacts /app/artifacts
COPY data /app/data
COPY experiments /app/experiments
COPY README.md model_card.md solution.py /app/

# Copy Built Frontend Standalone
COPY --from=frontend-builder /app/public /app/frontend/public
COPY --from=frontend-builder /app/.next/standalone /app/frontend/
COPY --from=frontend-builder /app/.next/static /app/frontend/.next/static

# Copy and setup entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose default Hugging Face Spaces port
EXPOSE 7860

CMD ["/app/entrypoint.sh"]
