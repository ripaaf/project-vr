@echo off
rem Builds the Quest apps and installs them on the Quest connected by USB / Wi-Fi ADB:
rem UTSUSHI Linux first (UTSUSHI asks for its permission), then UTSUSHI.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0quest-linux\build.ps1" -Install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0quest-app\build.ps1" -Install
pause
