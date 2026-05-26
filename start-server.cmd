@echo off
setlocal

cd /d "%~dp0"

echo Starting oh-my-codex harness...
echo Project: %CD%
echo.

if not exist "node_modules" (
  echo node_modules was not found. Installing dependencies first...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Opening http://127.0.0.1:3000
start "" "http://127.0.0.1:3000"
echo.
echo Keep this window open while using the harness.
echo Press Ctrl+C to stop the server.
echo.

call npm.cmd run dev

echo.
echo Server stopped.
pause
