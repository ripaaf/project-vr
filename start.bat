@echo off
title UTSUSHI
cd /d "%~dp0host"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js belum terinstall. Download dari https://nodejs.org lalu jalankan lagi.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8765
node server.js
pause
