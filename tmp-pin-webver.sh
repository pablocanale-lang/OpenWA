#!/bin/bash
set -eu
cd /opt/openwa
PIN="2.3000.1046805918-alpha"

python3 - <<PY
from pathlib import Path
pin = "${PIN}"
p = Path("/opt/openwa/.env")
text = p.read_text()
old = "WWEBJS_WEB_VERSION=off"
new = "WWEBJS_WEB_VERSION=" + pin
if old not in text and f"WWEBJS_WEB_VERSION={pin}" not in text:
    raise SystemExit("WWEBJS_WEB_VERSION=off not found in .env")
text = text.replace(old, new, 1)
p.write_text(text)
for line in text.splitlines():
    if line.startswith("WWEBJS_WEB_VERSION=") and not line.startswith("#"):
        print("env", line)
PY

echo "=== recreate api with settled WA Web pin ==="
docker compose up -d --force-recreate openwa-api
ok=0
for i in $(seq 1 24); do
  st=$(docker inspect openwa-api --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
  echo "t=${i} $st"
  if echo "$st" | grep -q 'running healthy'; then ok=1; break; fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  docker compose logs --tail 40 openwa-api
  exit 1
fi

echo "=== container pin ==="
docker compose exec -T openwa-api printenv WWEBJS_WEB_VERSION

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
print("poll", d.get("status"), "phone", d.get("phone"), "err", (d.get("lastError") or "")[:90])
PY
  st=$(python3 -c 'import json;from pathlib import Path;print(json.loads(Path("/tmp/pcc-now.json").read_text())[0]["status"])')
  if [ "$st" = "ready" ] || [ "$st" = "qr_ready" ]; then
    echo "STOP_POLL $st"
    break
  fi
  if [ "$st" = "failed" ] || [ "$st" = "disconnected" ]; then
    echo "ENDED $st"
    break
  fi
  sleep 10
done

echo "=== pin + adapter logs ==="
docker compose logs --since 8m openwa-api | grep -E 'web_version|Pinning WhatsApp|WhatsAppWebJsAdapter|ready_reconcile|premature_ready|LOGOUT|engine_error|SessionEngine' | tail -40
rm -f /tmp/pcc-start.json /tmp/pcc-now.json
