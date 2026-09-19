#!/bin/bash
set -eu
cd /opt/openwa
echo "=== env WWEBJS ==="
grep -n "WWEBJS" .env 2>/dev/null || true
echo "=== generated ==="
grep -n "WWEBJS" data/.env.generated 2>/dev/null || true
echo "=== container env ==="
docker compose exec -T openwa-api printenv | grep -E "WWEBJS|PUPPETEER|DISPLAY|ENGINE" || true
echo "=== compose override env ==="
grep -A20 "openwa-api:" docker-compose.override.yml | head -25
echo "=== session ==="
KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
echo "=== last pin logs ==="
docker compose logs --since 30m openwa-api | grep -E 'web_version|Pinning WhatsApp|WWEBJS|webVersion' | tail -20
