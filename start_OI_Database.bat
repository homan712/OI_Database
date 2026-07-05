@echo off
setlocal
cd /d "%~dp0"

echo Starting OI Database...

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Opening dashboard at http://127.0.0.1:5174/
start "OI Database API" /min cmd /c "cd /d ""%~dp0"" && node scripts/local-api-server.mjs"
start "" http://127.0.0.1:5174/

echo.
echo Keep this window open while using the dashboard.
echo Press Ctrl+C to stop the server.
echo The local data API runs in a minimized window.
echo.
call npm run dev -- --host 127.0.0.1 --port 5174

pause
