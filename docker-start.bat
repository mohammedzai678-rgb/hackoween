@echo off
echo ===================================================
echo   FLOODCAST - Starting Docker Containers
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo ===================================================

docker compose up --build
if errorlevel 1 (
    docker-compose up --build
)
pause
