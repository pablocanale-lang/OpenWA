@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=2785"
set "COMPOSE=docker compose -f docker-compose.dev.yml -f docker-compose.local.yml"
set "NOBROWSER=0"
if /I "%~1"=="--no-browser" set "NOBROWSER=1"

echo.
echo === OpenWA — start-local ===
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [error] Docker no esta en el PATH. Instala Docker Desktop y reintenta.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [error] Docker Desktop no esta corriendo. Abrilo y reintenta.
  exit /b 1
)

if not exist ".env" (
  echo [error] Falta .env en la raiz del repo.
  exit /b 1
)

if not exist "data" mkdir "data"

echo [1/3] Descargando imagen de produccion ^(ghcr.io/rmyndharis/openwa:0.23.3^)...
%COMPOSE% pull
if errorlevel 1 (
  echo [warn] No se pudo bajar la imagen. Compilando desde el Dockerfile ^(tarda varios minutos^)...
  docker compose -f docker-compose.dev.yml up -d --build
  if errorlevel 1 (
    echo [error] docker compose up --build fallo.
    exit /b 1
  )
  goto wait_ready
)

echo [2/3] Levantando contenedor...
%COMPOSE% up -d --no-build
if errorlevel 1 (
  echo [error] docker compose up fallo.
  exit /b 1
)

:wait_ready
echo [3/3] Esperando healthcheck en http://127.0.0.1:%PORT%/api/health/ready ...
set /a TRIES=0
:wait_loop
set /a TRIES+=1
curl.exe -sf "http://127.0.0.1:%PORT%/api/health/ready" >nul 2>&1
if not errorlevel 1 goto ready
if !TRIES! GEQ 60 (
  echo [error] Timeout esperando a OpenWA.
  echo         Ultimos logs:
  %COMPOSE% logs --tail 80
  exit /b 1
)
ping -n 3 127.0.0.1 >nul
goto wait_loop

:ready
echo.
echo [ok] OpenWA local listo.
echo.
echo   Dashboard:  http://127.0.0.1:%PORT%/
echo   API:        http://127.0.0.1:%PORT%/api
echo   Health:     http://127.0.0.1:%PORT%/api/health/ready
echo   Swagger:    http://127.0.0.1:%PORT%/api/docs
echo.
echo   API key local:  dev-admin-key
echo   ^(pegala en el dashboard cuando la pida^)
echo.
echo   Logs:   %COMPOSE% logs -f
echo   Parar:  .\stop-local.bat
echo.
if "!NOBROWSER!"=="0" start "" "http://127.0.0.1:%PORT%/"
exit /b 0
