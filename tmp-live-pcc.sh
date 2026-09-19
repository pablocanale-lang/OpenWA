#!/bin/bash
set -eu
cd /opt/openwa

echo "=== patch timeout assignment on disk (next load) ==="
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/openwa/hotfix/wwebjs-reconcile.js")
t = p.read_text()
# Restore the exports prelude that the naive replace smashed.
old_prelude = "exports.WwebjsReadyReconcile = exports.READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS = 180_000;"
new_prelude = "exports.WwebjsReadyReconcile = exports.READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS = exports.READY_RECONCILE_TIMEOUT_MS = void 0;"
if old_prelude in t:
    t = t.replace(old_prelude, new_prelude, 1)
t = t.replace("exports.READY_RECONCILE_TIMEOUT_MS = 90_000;", "exports.READY_RECONCILE_TIMEOUT_MS = 300_000;", 1)
t = t.replace("exports.READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS = 45_000;", "exports.READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS = 180_000;", 1)
if "READY_RECONCILE_TIMEOUT_MS = 90_000" in t:
    raise SystemExit("timeout still 90s after patch")
if "maybeReloadDeadBridge() {\n        return;" not in t:
    raise SystemExit("no-op method missing")
p.write_text(t)
print("disk patched for next process start")
for line in t.splitlines()[:10]:
    print(line)
PY

echo "=== live process (do not recreate) ==="
KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
echo "=== qr? ==="
curl -sS -o /tmp/pcc.json -w "qrhttp:%{http_code}\n" -H "X-API-Key: ${KEY}" \
  "http://127.0.0.1:2785/api/sessions/925993c0-e549-4b3a-bd2e-31c61265a36a"
python3 - <<'PY'
import json
from pathlib import Path
d=json.loads(Path("/tmp/pcc.json").read_text())
keys=sorted(d.keys())
print("keys", keys)
for k in ("id","name","status","phone","pushName","lastError","engineLoaded","qr","qrCode","relinkRequired"):
    if k in d:
        v=d[k]
        if k in ("qr","qrCode") and isinstance(v,str) and len(v)>40:
            print(k, "len", len(v), v[:24]+"...")
        else:
            print(k, v)
PY

echo "=== chrome/procs ==="
docker compose exec -T openwa-api sh -c 'ls /proc/*/exe 2>/dev/null | head; for f in /proc/[0-9]*/comm; do echo "$(cat $f 2>/dev/null) $(cat ${f%comm}cmdline 2>/dev/null | tr "\0" " ")"; done | grep -Ei "chrome|chromium|node" | head -20' || true

echo "=== all adapter logs since start ==="
docker compose logs --since 12m openwa-api | grep -E 'WhatsAppWebJsAdapter|WwebjsReadyReconcile|SessionEngine|authenticated|LOGOUT|ready_reconcile|event_bridge|LocalAuth|relink|QR generated|status' | tail -50
