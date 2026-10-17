@echo off
rem Builds windows-app\build\QuestMirror-Setup.exe — the one-file installer for the Windows app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-app\build.ps1"
pause
