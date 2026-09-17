@echo off
setlocal
cd /d "%~dp0"
docker compose stop
if errorlevel 1 (
  echo Failed to stop Glaux. Check Docker Desktop.
  pause
  exit /b 1
)
echo Glaux stopped. Conversation data is retained.
pause
