#!/bin/bash
set -eu
cd /opt/openwa

echo "=== restore reconcile.js from image, then no-op reload ==="
IMAGE=$(docker inspect openwa-api --format '{{.Image}}')
echo "image=$IMAGE"
mkdir -p /opt/openwa/hotfix
docker rm -f openwa-extract-reconcile >/dev/null 2>&1 || true
EXTRACT=$(docker create --name openwa-extract-reconcile "$IMAGE")
docker cp "$EXTRACT:/app/dist/engine/adapters/wwebjs-reconcile.js" /opt/openwa/hotfix/wwebjs-reconcile.js
docker rm "$EXTRACT" >/dev/null
echo "copied from image, bytes=$(wc -c < /opt/openwa/hotfix/wwebjs-reconcile.js)"

python3 - <<'PY'
from pathlib import Path
p = Path("/opt/openwa/hotfix/wwebjs-reconcile.js")
t = p.read_text()

# Constants: image may still have the 90s timeout that wipes LocalAuth mid first-link.
def sub_export(name, value):
    global t
    needle = f"exports.{name} = "
    i = t.find(needle)
    if i < 0:
        raise SystemExit(f"export {name} not found")
    j = t.find(";", i)
    t = t[:i] + needle + value + t[j:]

sub_export("READY_RECONCILE_TIMEOUT_MS", "300_000")
sub_export("READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS", "180_000")

# METHOD definition only — never the call site `this.maybeReloadDeadBridge();`
marker = "maybeReloadDeadBridge() {"
idx = 0
found = None
while True:
    i = t.find(marker, idx)
    if i < 0:
        break
    if i >= 5 and t[i - 5 : i] == "this.":
        idx = i + 1
        continue
    found = i
    break
if found is None:
    raise SystemExit("method definition not found")
brace = t.find("{", found)
depth = 0
end = None
for j in range(brace, len(t)):
    if t[j] == "{":
        depth += 1
    elif t[j] == "}":
        depth -= 1
        if depth == 0:
            end = j
            break
if end is None:
    raise SystemExit("could not find method end")
t = t[: brace + 1] + "\n        return;\n    " + t[end:]
p.write_text(t)
print("patched constants + no-op method")
print("--- method ---")
print(t[found : found + 80])
print("--- timeout ---")
for name in ("READY_RECONCILE_TIMEOUT_MS", "READY_RECONCILE_BRIDGE_RELOAD_GRACE_MS"):
    i = t.find(f"exports.{name}")
    print(t[i : i + 50])
PY
echo "=== node syntax ==="
docker run --rm -v /opt/openwa/hotfix/wwebjs-reconcile.js:/tmp/wwebjs-reconcile.js:ro --entrypoint node "$IMAGE" --check /tmp/wwebjs-reconcile.js
echo "js syntax ok"

echo "=== recreate api ==="
docker compose up -d --force-recreate openwa-api

echo "=== wait healthy ==="
ok=0
for i in $(seq 1 24); do
  st=$(docker inspect openwa-api --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}' 2>/dev/null || echo "missing")
  echo "t=${i} $st"
  if echo "$st" | grep -q 'running healthy'; then
    ok=1
    break
  fi
  if echo "$st" | grep -q 'restarting'; then
    echo "=== crash logs ==="
    docker compose logs --tail 40 openwa-api || true
  fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "api did not become healthy"
  docker compose logs --tail 80 openwa-api || true
  exit 1
fi

KEY=$(docker compose exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')
echo "=== sessions before start ==="
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
echo "=== START pcc (keep session-pcc) ==="
curl -sS -o /tmp/pcc-start.json -w "start:%{http_code}\n" -X POST \
  -H "X-API-Key: ${KEY}" \
  "http://127.0.0.1:2785/api/sessions/925993c0-e549-4b3a-bd2e-31c61265a36a/start"
cat /tmp/pcc-start.json
echo
sleep 20
echo "=== sessions after start ==="
curl -sS -H "X-API-Key: ${KEY}" http://127.0.0.1:2785/api/sessions
echo
echo "=== recent logs ==="
docker compose logs --since 1m openwa-api | grep '{"timestamp"' | tail -20
rm -f /tmp/pcc-start.json
