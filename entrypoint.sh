#!/bin/bash
set -e

echo "=========================================================="
echo "  Starting FLOODCAST Unified Container (Railway / Cloud)"
echo "=========================================================="

# Limit thread concurrency and memory spikes on cloud CPU
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_FLASH_ATTENTION=1
export OMP_NUM_THREADS=2
export MKL_NUM_THREADS=2

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

# Ensure model is ready (pull lightweight 350MB model for cloud memory efficiency)
DEPLOY_MODEL="${OLLAMA_MODEL:-qwen2.5:0.5b}"
if ! ollama list 2>/dev/null | grep -q "$DEPLOY_MODEL"; then
  echo "Pulling $DEPLOY_MODEL model in background..."
  ollama pull "$DEPLOY_MODEL" &
fi

# 2. Launch FastAPI backend on internal port 8000 with auto-supervisor
echo "[2/3] Launching FastAPI Backend on 127.0.0.1:8000..."
(
  while true; do
    uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
    echo "[FASTAPI] Backend process exited. Auto-respawning in 1s..."
    sleep 1
  done
) &

# Wait for backend to be ready
echo "Waiting for backend healthcheck..."
for i in $(seq 1 40); do
  if curl -s http://127.0.0.1:8000/api/v1/health | grep -q "ok"; then
    echo "[SUCCESS] Backend is healthy and ready!"
    break
  fi
  sleep 1
done

# 3. Launch Next.js frontend (respects Railway $PORT or defaults to 8080)
export PORT=${PORT:-8080}
export HOSTNAME="0.0.0.0"
echo "[3/3] Launching Next.js on port $PORT..."
cd /app/frontend
exec node server.js
