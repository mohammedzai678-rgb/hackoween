#!/usr/bin/env bash
set -e

echo "==================================================="
echo "  FLOODCAST - Starting Docker Containers"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "==================================================="

if command -v docker-compose &> /dev/null; then
    docker-compose up --build
else
    docker compose up --build
fi
