#!/bin/bash
set -eu
cd /opt/openwa
echo "=== hotfix constants ==="
grep -n "READY_RECONCILE" /opt/openwa/hotfix/wwebjs-reconcile.js
echo "=== method ==="
grep -n -A4 "maybeReloadDeadBridge" /opt/openwa/hotfix/wwebjs-reconcile.js
echo "=== chrome ==="
docker compose exec -T openwa-api sh -c 'ps -o pid,etime,args | grep -E "[c]hrome|[c]hromium" | head -8' || true
echo "=== sessions ==="
KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
echo "=== reconcile/auth logs ==="
docker compose logs --since 8m openwa-api | grep -E 'ready_reconcile|authenticated|LOGOUT|auth_cleared|event_bridge|missed; reconcil|QR|relink|failed|FAILED|Marked session|phone' | tail -40
echo "=== last json logs ==="
docker compose logs --since 3m openwa-api | grep '{"timestamp"' | tail -15
