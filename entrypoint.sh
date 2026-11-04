#!/bin/bash
set -e

echo "=========================================================="
echo "  Starting FLOODCAST Unified Container (Hugging Face Space)"
echo "=========================================================="

# 1. Launch FastAPI backend on internal port 8000
echo "[1/2] Launching FastAPI Backend on 127.0.0.1:8000..."
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

# 2. Launch Next.js frontend (respects Railway $PORT or defaults to 7860)
echo "[2/2] Launching Next.js on port ${PORT:-7860}..."
cd /app/frontend
export PORT=${PORT:-7860}
export HOSTNAME="0.0.0.0"
exec node server.js
