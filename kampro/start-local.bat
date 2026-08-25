@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=3100"
set "PIDFILE=%~dp0.local\api.pid"
set "LOGFILE=%~dp0.local\api.log"
set "SEED=0"
set "DEMO=0"
set "NOBROWSER=0"

if /I "%~1"=="--seed" set "SEED=1"
if /I "%~2"=="--seed" set "SEED=1"
if /I "%~1"=="--demo" set "DEMO=1"
if /I "%~2"=="--demo" set "DEMO=1"
if /I "%~1"=="--no-browser" set "NOBROWSER=1"
if /I "%~2"=="--no-browser" set "NOBROWSER=1"

echo.
echo === Kampro CRM — Importacion ^(capa OpenWA^) ===
echo.

if not exist ".env" (
  echo [info] Creando .env desde env.example...
  copy /Y "env.example" ".env" >nul
)

if not exist "data" mkdir "data"
if not exist ".local" mkdir ".local"

where node >nul 2>&1
if errorlevel 1 (
  echo [error] Node.js no esta en el PATH.
  exit /b 1
)

if not exist "node_modules" (
  echo [1/4] npm install...
  call npm install
  if errorlevel 1 exit /b 1
) else (
  echo [1/4] dependencias OK
)

echo [2/4] Prisma generate + db push + catalogo...
call npx prisma generate
if errorlevel 1 exit /b 1
call npx prisma db push
if errorlevel 1 exit /b 1
call npx tsx prisma\seed.ts
if errorlevel 1 exit /b 1

if "!DEMO!"=="1" (
  echo       Seed demo importacion...
  call npx tsx prisma\seed.ts --demo
  if errorlevel 1 exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
  echo [info] Ya hay algo en el puerto !PORT! ^(PID %%P^).
  if "!NOBROWSER!"=="0" start "" "http://127.0.0.1:!PORT!/"
  exit /b 0
)

echo [3/4] Arrancando API...
echo.>"%LOGFILE%"
start "Kampro CRM" /MIN cmd /c "cd /d "%~dp0" && npx tsx src\index.ts >> "%LOGFILE%" 2>&1"

echo [4/4] Esperando http://127.0.0.1:!PORT!/health ...
set /a WAIT=0
:wait_api
set /a WAIT+=1
curl.exe -sf "http://127.0.0.1:!PORT!/health" >nul 2>&1
if not errorlevel 1 (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do echo %%P>"%PIDFILE%"
  echo.
  echo [ok] Kampro CRM en http://127.0.0.1:!PORT!/
  echo      API key local: dev-kampro-key-change-me
  echo      OpenWA gateway: http://127.0.0.1:2785/
  echo      Parar: .\stop-local.bat
  echo.
  if "!NOBROWSER!"=="0" start "" "http://127.0.0.1:!PORT!/"
  exit /b 0
)
if !WAIT! GEQ 40 (
  echo [error] La API no abrio el puerto !PORT!.
  if exist "%LOGFILE%" type "%LOGFILE%"
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto wait_api
