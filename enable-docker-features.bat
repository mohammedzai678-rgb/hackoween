@echo off
echo ========================================================
echo   Installing Windows Subsystem for Linux (WSL)...
echo ========================================================
echo.

echo [*] Enabling WSL Windows feature...
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

echo [*] Installing WSL core package...
wsl.exe --install --no-distribution

echo [*] Updating WSL kernel...
wsl.exe --update

echo.
echo ========================================================
echo   [SUCCESS] WSL installation complete!
echo   You can now launch Docker Desktop.
echo ========================================================
echo.
pause
