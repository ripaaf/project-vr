@echo off
rem Builds the Quest app and installs it on the Quest connected by USB / Wi-Fi ADB.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0quest-app\build.ps1" -Install
pause
