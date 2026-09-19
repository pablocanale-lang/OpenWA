#!/bin/bash
set -eu
cd /opt/openwa
echo "=== container ==="
docker ps -a --filter name=openwa-api --format '{{.ID}} {{.Status}} {{.Names}}'
echo "=== inspect ==="
docker inspect openwa-api --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}'
echo "=== last logs ==="
docker compose logs --tail 80 openwa-api
echo "=== hotfix method ==="
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/openwa/hotfix/wwebjs-reconcile.js")
t = p.read_text()
idx = t.find("maybeReloadDeadBridge")
print("exists", p.exists(), "size", p.stat().st_size)
print(t[idx:idx+400] if idx>=0 else "METHOD MISSING")
PY
echo "=== mount ==="
docker inspect openwa-api --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
echo "=== compose override ==="
cat /opt/openwa/docker-compose.override.yml
