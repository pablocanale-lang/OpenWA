@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo === Kampro dentro de OpenWA ===
echo.

if not exist "kampro\start-local.bat" (
  echo [error] No encuentro kampro\start-local.bat
  exit /b 1
)

echo [1/2] API Kampro...
call "%~dp0kampro\start-local.bat" --no-browser --demo
if errorlevel 1 exit /b 1

echo.
echo [2/2] Dashboard OpenWA con menu Importacion ^(Vite :2886^)...
cd /d "%~dp0dashboard"
if not exist "node_modules" (
  echo       npm ci en dashboard...
  call npm ci
  if errorlevel 1 exit /b 1
)

start "OpenWA Dashboard" /MIN cmd /c "cd /d "%~dp0dashboard" && npm run dev"

echo.
echo [ok] Abri el dashboard de desarrollo ^(no el de Docker en :2785^):
echo      http://127.0.0.1:2886/inventory
echo      http://127.0.0.1:2886/orders
echo.
echo      Login OpenWA: dev-admin-key
echo      WhatsApp / API: http://127.0.0.1:2785
echo.
start "" "http://127.0.0.1:2886/imports"
exit /b 0
