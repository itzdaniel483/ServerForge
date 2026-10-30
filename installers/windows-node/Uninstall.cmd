@echo off
rem ServerForge Node uninstall (claude, 2026-10-30). Double-click this file.
setlocal
cd /d "%~dp0"
net session >/dev/null 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath %~f0 -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Uninstall
echo.
pause
