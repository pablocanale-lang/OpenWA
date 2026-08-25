@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PIDFILE=%~dp0.local\api.pid"
set "PORT=3100"

echo.
echo === Kampro CRM — stop-local ===
echo.

if exist "%PIDFILE%" (
  set /p APIPID=<"%PIDFILE%"
  if defined APIPID (
    echo Deteniendo API ^(PID !APIPID!^)...
    taskkill /PID !APIPID! /T /F >nul 2>&1
  )
  del /F /Q "%PIDFILE%" >nul 2>&1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
  echo Liberando puerto !PORT! ^(PID %%P^)...
  taskkill /PID %%P /T /F >nul 2>&1
)

echo [ok] Kampro detenido. La base SQLite en data\ se conserva.
exit /b 0
