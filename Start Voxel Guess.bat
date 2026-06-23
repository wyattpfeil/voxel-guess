@echo off
cd /d "%~dp0"
title Voxel Guess
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing required packages ^(first launch only^)...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
set HOST_TOKEN=teacher-%RANDOM%-%RANDOM%-%RANDOM%
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000/host.html?token=%HOST_TOKEN%'"
call npm start
pause
