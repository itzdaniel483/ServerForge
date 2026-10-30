@echo off
rem ServerForge Node setup (claude, 2026-10-30). Double-click this file.
rem It asks for administrator rights, then runs setup.ps1 from this folder.
setlocal
cd /d "%~dp0"
net session >/dev/null 2>&1
if %errorlevel% neq 0 (
    echo Asking for administrator rights...
    powershell -NoProfile -Command "Start-Process -FilePath %~f0 -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
