#!/bin/bash
set -e

echo "=========================================================="
echo "  Starting FLOODCAST Unified Container (Railway / Cloud)"
echo "=========================================================="

# Optimize thread concurrency and KV cache for 8GB RAM cloud container
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
# Keep the selected local chat model permanently warm in 8GB RAM for lowest latency.
export OLLAMA_KEEP_ALIVE=60m
export OMP_NUM_THREADS=4
export MKL_NUM_THREADS=4

# Best quality-to-latency model for 8GB RAM (~986MB Q4_K_M, zero thinking overhead).
export FLOODCAST_CHAT_MODEL="${FLOODCAST_CHAT_MODEL:-qwen2.5:1.5b}"

# 1. Start Ollama local LLM engine in background
echo "[1/3] Launching Ollama LLM Service on 127.0.0.1:11434..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
ollama_ready=0
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:11434/ | grep -q "Ollama is running"; then
    echo "[SUCCESS] Ollama service is healthy and ready!"
    ollama_ready=1
    break
  fi
  sleep 1
done

if [ "$ollama_ready" -ne 1 ]; then
  echo "[ERROR] Ollama did not become ready within 30 seconds."
  exit 1
fi

# Ensure the selected model is installed before the backend accepts requests.
if ! ollama list 2>/dev/null | grep -Fq "$FLOODCAST_CHAT_MODEL"; then
  echo "Pulling $FLOODCAST_CHAT_MODEL..."
  ollama pull "$FLOODCAST_CHAT_MODEL"
fi

# Load the model once before serving traffic, so the first user does not pay its cold-start cost.
echo "Warming the local chat model..."
python - <<'PY'
import json
import os
import urllib.request

model = os.environ["FLOODCAST_CHAT_MODEL"]
num_threads = max(2, min(6, (os.cpu_count() or 4)))
static_system_prompt = (
    "You are FLOODCAST Assistant, a fast, accurate AI hydrologist and general-purpose assistant. "
    "When [VERIFIED CONTEXT] is provided, quote exact station IDs, names, rainfall (mm), peak discharge (cfs), "
    "P90 surge days, and ML metrics without guessing. Answer concisely in clean Markdown."
)
payload = {
    "model": model,
    "messages": [
        {"role": "system", "content": static_system_prompt},
        {"role": "user", "content": "OK"},
    ],
    "think": False,
    "stream": False,
    "keep_alive": "60m",
    "options": {"num_ctx": 1536, "num_predict": 4, "num_thread": num_threads, "temperature": 0},
}
request = urllib.request.Request(
    "http://127.0.0.1:11434/api/chat",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=180) as response:
    result = json.loads(response.read().decode("utf-8"))
if not result.get("message", {}).get("content", "").strip():
    raise SystemExit("Ollama model warm-up returned no answer.")
print("[SUCCESS] Ollama model generated a warm-up response.")
PY

# 2. Launch FastAPI backend on internal port 8000 with auto-supervisor
echo "[2/3] Launching FastAPI Backend on 127.0.0.1:8000..."
(
  while true; do
    if uvicorn backend.app.main:app --host 127.0.0.1 --port 8000; then
      backend_exit_status=0
      echo "[FASTAPI] Backend exited with status 0. Restarting in 1s..."
    else
      backend_exit_status=$?
      echo "[FASTAPI] Backend exited with status ${backend_exit_status}. Restarting in 1s..."
    fi
    sleep 1
  done
) &

# Wait for backend to be ready
echo "Waiting for backend healthcheck..."
backend_ready=0
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "[SUCCESS] Backend is healthy and ready!"
    backend_ready=1
    break
  fi
  sleep 1
done

if [ "$backend_ready" -ne 1 ]; then
  echo "[ERROR] Backend did not become healthy within 40 seconds; stopping container startup."
  exit 1
fi

# 3. Launch Next.js frontend (respects Railway $PORT or defaults to 8080)
export PORT=${PORT:-8080}
export HOSTNAME="0.0.0.0"
echo "[3/3] Launching Next.js on port $PORT..."
cd /app/frontend
exec node server.js
