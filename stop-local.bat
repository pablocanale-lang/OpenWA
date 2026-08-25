@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo === OpenWA — stop-local ===
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [error] Docker no esta en el PATH.
  exit /b 1
)

echo [1/1] Parando contenedor ^(se conserva ./data y la sesion de WhatsApp^)...
docker compose -f docker-compose.dev.yml -f docker-compose.local.yml stop
if errorlevel 1 (
  docker compose -f docker-compose.dev.yml stop
)

echo.
echo [ok] OpenWA local detenido.
echo      Para borrar el contenedor sin tocar datos: docker compose -f docker-compose.dev.yml -f docker-compose.local.yml down
echo      Para arrancar de nuevo: .\start-local.bat
echo.
exit /b 0
