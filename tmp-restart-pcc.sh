#!/bin/bash
set -eu
cd /opt/openwa

echo "=== confirm hotfix on disk ==="
grep -n "READY_RECONCILE_TIMEOUT_MS\|READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS\|maybeReloadDeadBridge" /opt/openwa/hotfix/wwebjs-reconcile.js | head -20

echo "=== recreate api to load 300s + no-op reload ==="
docker compose up -d --force-recreate openwa-api

ok=0
for i in $(seq 1 24); do
  st=$(docker inspect openwa-api --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
  echo "t=${i} $st"
  if echo "$st" | grep -q 'running healthy'; then ok=1; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  docker compose logs --tail 50 openwa-api
  exit 1
fi

KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
echo "=== START pcc keep profile ==="
curl -sS -o /tmp/pcc-start.json -w "start:%{http_code}\n" -X POST \
  -H "X-API-Key: ${KEY}" \
  "http://127.0.0.1:2785/api/sessions/925993c0-e549-4b3a-bd2e-31c61265a36a/start"
cat /tmp/pcc-start.json
echo

for i in $(seq 1 36); do
  curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions > /tmp/pcc-now.json
  python3 - <<'PY'
import json
from pathlib import Path
d=json.loads(Path("/tmp/pcc-now.json").read_text())[0]
print("poll", d.get("status"), "phone", d.get("phone"), "err", (d.get("lastError") or "")[:80])
PY
  st=$(python3 -c 'import json;from pathlib import Path;print(json.loads(Path("/tmp/pcc-now.json").read_text())[0]["status"])')
  if [ "$st" = "connected" ] || [ "$st" = "ready" ] || [ "$st" = "working" ]; then
    echo "SUCCESS"
    break
  fi
  if [ "$st" = "failed" ] || [ "$st" = "disconnected" ]; then
    echo "ENDED $st"
    break
  fi
  sleep 10
done

echo "=== chrome ==="
docker compose exec -T openwa-api sh -c 'for f in /proc/[0-9]*/comm; do c=$(cat "$f" 2>/dev/null || true); echo "$c"; done' | grep -Ei 'chrome|chromium' | sort | uniq -c | head
echo "=== logs ==="
docker compose logs --since 8m openwa-api | grep '{"timestamp"' | grep -E 'WhatsAppWebJsAdapter|SessionEngine|ready_reconcile|authenticated|LOGOUT|QR |phone|missed; reconcil' | tail -25
rm -f /tmp/pcc-start.json /tmp/pcc-now.json
