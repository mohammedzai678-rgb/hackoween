#!/bin/bash
set -e

echo "=========================================================="
echo "  Starting FLOODCAST Unified Container (Railway / Cloud)"
echo "=========================================================="

# 1. Start Ollama local LLM engine in background
echo "[1/3] Launching Ollama LLM Service on 127.0.0.1:11434..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:11434/ | grep -q "Ollama is running"; then
    echo "[SUCCESS] Ollama service is healthy and ready!"
    break
  fi
  sleep 1
done

# Ensure model is ready (pull in background if not already pre-cached)
if ! ollama list 2>/dev/null | grep -q "qwen2.5:1.5b"; then
  echo "Pulling qwen2.5:1.5b model in background..."
  ollama pull qwen2.5:1.5b &
fi

# 2. Launch FastAPI backend on internal port 8000
echo "[2/3] Launching FastAPI Backend on 127.0.0.1:8000..."
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend healthcheck..."
for i in $(seq 1 40); do
  if curl -s http://127.0.0.1:8000/api/v1/health | grep -q "ok"; then
    echo "[SUCCESS] Backend is healthy and ready!"
    break
  fi
  sleep 1
done

# 3. Launch Next.js frontend (respects Railway $PORT or defaults to 7860)
echo "[3/3] Launching Next.js on port ${PORT:-7860}..."
cd /app/frontend
export PORT=${PORT:-7860}
export HOSTNAME="0.0.0.0"
exec node server.js
