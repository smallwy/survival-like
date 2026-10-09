@echo off
rem ============================================================
rem  ON-PURPOSE CONSTRAINTS - please do not "clean up"
rem  This file MUST stay CRLF + pure ASCII. cmd.exe only parses
rem  CRLF, and non-ASCII bytes get misread on GBK code pages.
rem  All Chinese usage notes are in the readme file next to this .bat.
rem ============================================================
setlocal
title SanGuo Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   SanGuo ZhuLu - Pixel Three Kingdoms Survivor
echo ============================================
echo.
echo [1/3] Starting backend (Go) on port 8099 ...
start "SG-Backend" cmd /k "cd /d %ROOT%\server && set APP_PORT=8099 && set APP_DATA_DIR=data && survivors-server.exe"

echo [2/3] Starting frontend (Vite) on port 5173 --open ...
start "SG-Frontend" cmd /k "cd /d %ROOT%\web && npm run dev -- --open"

echo.
echo Backend + frontend windows opened. Do NOT close them.
echo To stop the game, close those two black windows.
echo If the browser does not open, visit http://localhost:5173 manually.
echo.
pause
