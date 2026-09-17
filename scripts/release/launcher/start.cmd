@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 goto missing
docker info >nul 2>&1
if errorlevel 1 goto missing
docker compose version
if errorlevel 1 goto failed
if exist images.tar (
  docker load -i images.tar
  if errorlevel 1 goto failed
)
docker compose up -d --wait --wait-timeout 120 --pull missing
if errorlevel 1 goto failed
for /f "delims=" %%A in ('docker compose port web 8080') do (
  echo Glaux is ready: http://%%A
  start "" "http://%%A"
)
echo Run stop.cmd to stop Glaux. Closing the browser does not stop it.
pause
exit /b 0
:missing
echo Install and start Docker Desktop, then try again.
echo https://docs.docker.com/get-docker/
pause
exit /b 1
:failed
echo Startup failed. Check Docker, network access and port availability.
echo Run: docker compose logs --tail=100
pause
exit /b 1
