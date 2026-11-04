@echo off
title FLOODCAST Full-Stack Launcher
echo ===================================================
echo   FLOODCAST - Starting Full-Stack Application
echo ===================================================
echo [1/2] Starting Python FastAPI ML Backend on :8000 ...
start "FLOODCAST Backend (:8000)" cmd /k "python -m uvicorn backend.app.main:app --reload --port 8000"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Next.js 14 Frontend on :3000 ...
start "FLOODCAST Frontend (:3000)" cmd /k "cd frontend && npm run dev"

timeout /t 2 /nobreak >nul

echo ===================================================
echo   Services are launching!
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo   Docs:     http://localhost:8000/docs
echo ===================================================
echo Opening your browser in 4 seconds...
timeout /t 4 /nobreak >nul
start http://localhost:3000
