#!/usr/bin/env bash
#
# Deploy OpenWA + Kampro CRM to the production VPS (root@206.189.206.119, /opt/openwa).
#
# Order of operations (see docs/ai/05-instalacion-ejecucion-y-deploy.md):
#   1. Package the target ref with `git archive` and ship it to the VPS as a single tarball.
#   2. Tests run on the VPS itself, in a throwaway scratch directory OUTSIDE /opt/openwa
#      (/opt/openwa-deploy-scratch-<timestamp>): `npm ci` + `npm run test --runInBand` for
#      OpenWA, `npm ci` + `npm run test` for Kampro, and `npm run dashboard:build` if
#      dashboard/ changed. Abort here on any failure — nothing below runs, nothing in
#      /opt/openwa or the live containers is touched. This intentionally does NOT run on the
#      operator's machine: a chunk of OpenWA's suite asserts real POSIX file-permission bits
#      (chmod/stat mode 0600/0700) that Windows/NTFS cannot reproduce, so `npm run test` can
#      never pass there regardless of the code (see the 2026-09-19 deploy-design discussion).
#      Tests run niced/ionice'd (idle priority) so they don't starve the live Chrome/WhatsApp
#      process on this small droplet.
#   3. Remote backup, before touching anything: OpenWA's data (main.sqlite, openwa.sqlite, the
#      whatsapp-web.js session, media, plugins — via the project's own scripts/backup.sh run
#      INSIDE the openwa-api container, then copied out), Kampro's kampro.sqlite, and the current
#      docker-compose.override.yml. All land in /opt/openwa/backups/<timestamp>/.
#   4. Promote the already-tested scratch tree into /opt/openwa via rsync (server-side; no
#      second transfer). Protects (never overwrites/deletes): .env, kampro/.env, data/,
#      kampro/data/, node_modules/, .git/, *.sqlite*, hotfix/ (a server-only live patch not
#      tracked in this repo — see .cursor/rules/openwa-vps-headed.mdc), backups/,
#      .last-deploy-sha.
#   5. Kampro schema: `npx prisma generate` + `npx prisma db push` on the live kampro/ tree —
#      NEVER `migrate deploy`. This project has no prisma/migrations/ directory (neither
#      locally nor on the VPS); Prisma Migrate was never initialized here. Introducing it now
#      would require baselining a production database that already holds real business data,
#      which is exactly the data-loss risk we decided (2026-09-19) to avoid. Keep using
#      `db push`.
#   6. Restart:
#        - kampro.service (systemd) restarts whenever kampro/ changed. Low risk: a plain
#          Fastify process, no browser/session state.
#        - openwa-api (Docker) is rebuilt + recreated ONLY when files outside kampro/ changed.
#          This is the ONE step that touches the live WhatsApp bridge. The rules in
#          .cursor/rules/openwa-vps-headed.mdc are absolute here: never set
#          WWEBJS_WEB_VERSION=off, never force PUPPETEER_HEADLESS=true, never delete
#          session-pcc or the openwa-data volume, never reload the page mid-sync, never
#          re-scan a QR unless a human confirmed the session actually logged out.
#   7. Healthcheck: GET /health on both services, then confirm the WhatsApp session status is
#      still "ready" (AUTO_START_SESSIONS=true means a routine container recreate should
#      reconnect on its own — the script only calls POST /start once, as a fallback, if the
#      session hasn't come back on its own after a short wait). On any failure: stop, print
#      full diagnostics, exit non-zero. No automatic rollback of the WhatsApp session — a
#      human decides that.
#
# Safety defaults:
#   - Deploys a git ref (default HEAD). Requires a clean working tree unless --allow-dirty.
#   - Prints a plan (files changed since the last deploy, whether openwa-api/WhatsApp will be
#     touched, whether a Kampro schema push will run) and requires typing DEPLOY, unless --yes.
#   - Does NOT delete files on the server unless --prune is passed explicitly.
#   - Never prints secrets. Reads the OpenWA API key remotely, inside the container, only to
#     call /api/sessions for a status check; the value itself is never echoed or logged.
#   - Cleans up its own scratch dir + tarball on the VPS on exit, success or failure.
#
# Usage:
#   scripts/deploy-vps.sh [--yes] [--dry-run] [--allow-dirty] [--prune] [--ref <git-ref>]
#
set -euo pipefail
umask 077

VPS_HOST="${DEPLOY_VPS_HOST:-root@206.189.206.119}"
VPS_DIR="${DEPLOY_VPS_DIR:-/opt/openwa}"
SESSION_ID="${DEPLOY_SESSION_ID:-925993c0-e549-4b3a-bd2e-31c61265a36a}" # sesión "pcc"

REF="HEAD"
ASSUME_YES=0
DRY_RUN=0
ALLOW_DIRTY=0
PRUNE=0

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --prune) PRUNE=1 ;;
    --ref) shift; REF="${1:?--ref requires a value}" ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) die "opción desconocida: $1" ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

command -v git >/dev/null 2>&1 || die "git no encontrado"
command -v ssh >/dev/null 2>&1 || die "ssh no encontrado"
command -v scp >/dev/null 2>&1 || die "scp no encontrado"

ssh_remote() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" "$@"
}

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------
log "Probando acceso SSH a $VPS_HOST ..."
ssh_remote "echo ok" >/dev/null || die "no se pudo conectar a $VPS_HOST por SSH"

if [ "$ALLOW_DIRTY" -ne 1 ] && [ -n "$(git status --porcelain)" ]; then
  die "working tree con cambios sin commitear. Commiteá o usá --allow-dirty (no recomendado)."
fi

TARGET_SHA="$(git rev-parse "$REF")"
TARGET_SUBJECT="$(git log -1 --format=%s "$TARGET_SHA")"

log "Leyendo último SHA desplegado en el VPS ..."
LAST_SHA="$(ssh_remote "cat $VPS_DIR/.last-deploy-sha 2>/dev/null || true")"

if [ -z "$LAST_SHA" ]; then
  log "No hay marca de deploy previo (.last-deploy-sha). Se trata como deploy completo."
  DIFF_BASE="$(git hash-object -t tree /dev/null)"
  FIRST_DEPLOY=1
else
  if ! git cat-file -e "$LAST_SHA" 2>/dev/null; then
    die "el SHA registrado en el VPS ($LAST_SHA) no existe en este repo local. Revisá manualmente antes de seguir (¿ramas distintas?)."
  fi
  DIFF_BASE="$LAST_SHA"
  FIRST_DEPLOY=0
fi

CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" "$TARGET_SHA")"
ROOT_CHANGED=0
KAMPRO_CHANGED=0
SCHEMA_CHANGED=0
DASHBOARD_CHANGED=0
if grep -qv '^kampro/' <<< "$CHANGED_FILES"; then ROOT_CHANGED=1; fi
if grep -q '^kampro/' <<< "$CHANGED_FILES"; then KAMPRO_CHANGED=1; fi
if grep -q '^kampro/prisma/schema.prisma$' <<< "$CHANGED_FILES"; then SCHEMA_CHANGED=1; fi
if grep -q '^dashboard/' <<< "$CHANGED_FILES"; then DASHBOARD_CHANGED=1; fi

# ---------------------------------------------------------------------------
# Plan / confirmación
# ---------------------------------------------------------------------------
echo
echo "===================== PLAN DE DEPLOY ====================="
echo "Ref a desplegar : $REF ($TARGET_SHA)"
echo "Mensaje         : $TARGET_SUBJECT"
if [ "$FIRST_DEPLOY" -eq 1 ]; then
  echo "Base de comparación: (sin deploy previo registrado -> deploy completo)"
else
  echo "Último deploy   : $LAST_SHA"
fi
echo "Archivos cambiados: $(grep -c . <<< "$CHANGED_FILES" || true)"
echo "¿Toca kampro/?        : $([ $KAMPRO_CHANGED -eq 1 ] && echo si || echo no)"
echo "¿Toca schema.prisma?  : $([ $SCHEMA_CHANGED -eq 1 ] && echo 'si -> se correrá prisma db push' || echo no)"
echo "¿Toca dashboard/?     : $([ $DASHBOARD_CHANGED -eq 1 ] && echo si || echo no)"
echo "¿Toca OpenWA/src fuera de kampro/? : $([ $ROOT_CHANGED -eq 1 ] && echo 'SI -> se reconstruye y recrea el contenedor openwa-api (toca la sesión pcc)' || echo no)"
echo "Borrado de archivos huérfanos en el VPS (--prune): $([ $PRUNE -eq 1 ] && echo activado || echo 'desactivado (solo se agregan/actualizan archivos)')"
echo "Tests: corren EN EL VPS (scratch dir fuera de /opt/openwa), no en esta máquina."
echo "============================================================"
echo

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN: no se ejecuta nada contra el VPS. Fin."
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Escribí DEPLOY para continuar contra producción: " CONFIRM
  [ "$CONFIRM" = "DEPLOY" ] || die "cancelado por el usuario."
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_BACKUP_DIR="$VPS_DIR/backups/$TIMESTAMP"
REMOTE_TAR="/tmp/openwa-deploy-$TIMESTAMP.tar"
REMOTE_SCRATCH="/opt/openwa-deploy-scratch-$TIMESTAMP"

cleanup_remote_scratch() {
  ssh_remote "rm -rf '$REMOTE_SCRATCH' '$REMOTE_TAR'" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# 1. Empaquetar y copiar el ref al VPS
# ---------------------------------------------------------------------------
log "Empaquetando $REF con git archive ..."
LOCAL_TMP="$(mktemp -d)"
trap 'rm -rf "$LOCAL_TMP"; cleanup_remote_scratch' EXIT
TARBALL="$LOCAL_TMP/deploy-$TIMESTAMP.tar"
# -c core.autocrlf=false: en Windows, core.autocrlf=true hace que `git archive` escriba CRLF para
# todo archivo sin `eol=lf` explícito en .gitattributes (casi todo el repo salvo *.sh/Dockerfile*/
# *.patch/*.asc). El tar/Windows local "esconde" esto al extraer (normaliza CRLF->LF de nuevo), pero
# el VPS (GNU tar real) preserva los bytes tal cual y termina con CRLF de verdad en el código
# desplegado. Forzar autocrlf=false acá garantiza el mismo contenido LF que ve `git show`,
# sin importar la config local de quien corra el script. Descubierto y verificado el 2026-09-19
# contra config/feature-flags.spec.ts, que falla exactamente así con CRLF.
git -c core.autocrlf=false archive --format=tar "$TARGET_SHA" -o "$TARBALL"

log "Copiando tarball al VPS ..."
scp -q "$TARBALL" "$VPS_HOST:$REMOTE_TAR"

# ---------------------------------------------------------------------------
# 2. Tests en el VPS, en un directorio scratch fuera de /opt/openwa (aborta si falla)
# ---------------------------------------------------------------------------
log "Corriendo tests EN EL VPS (scratch dir, no toca /opt/openwa) ..."
ssh_remote bash -s -- "$REMOTE_TAR" "$REMOTE_SCRATCH" "$DASHBOARD_CHANGED" <<'REMOTE_EOF'
set -euo pipefail
REMOTE_TAR="$1"
SCRATCH="$2"
DASHBOARD_CHANGED="$3"

NICE=(nice -n 19)
command -v ionice >/dev/null 2>&1 && NICE=(nice -n 19 ionice -c3)

mkdir -p "$SCRATCH"
tar -xf "$REMOTE_TAR" -C "$SCRATCH"
cd "$SCRATCH"

echo "=== npm ci (OpenWA; incluye dashboard/ vía postinstall) ==="
"${NICE[@]}" npm ci --no-audit --no-fund

echo "=== npm run test (OpenWA, --runInBand para no competir por CPU/RAM con Chrome) ==="
"${NICE[@]}" npm run test -- --runInBand

echo "=== Kampro: npm ci + npm run test ==="
(cd kampro && "${NICE[@]}" npm ci --no-audit --no-fund && "${NICE[@]}" npm run test)

if [ "$DASHBOARD_CHANGED" = "1" ]; then
  echo "=== dashboard/ cambió: build de verificación ==="
  "${NICE[@]}" npm run dashboard:build
fi

echo "TESTS_OK"
REMOTE_EOF

# ---------------------------------------------------------------------------
# 3. Backup remoto (antes de tocar /opt/openwa)
# ---------------------------------------------------------------------------
log "Backup remoto en $REMOTE_BACKUP_DIR ..."
ssh_remote "mkdir -p '$REMOTE_BACKUP_DIR'"

log "  -> OpenWA: corriendo scripts/backup.sh dentro del contenedor openwa-api ..."
ssh_remote bash -s -- "$VPS_DIR" "$REMOTE_BACKUP_DIR" <<'REMOTE_EOF'
set -euo pipefail
VPS_DIR="$1"
DEST="$2"
cd "$VPS_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.override.yml)
# invocado como `bash script.sh` (no exec directo, no `sh`): la imagen copia backup.sh sin bit
# +x, y el propio script usa `set -o pipefail` (bash-only) -- /bin/sh del contenedor es dash y
# no soporta esa opción ("Illegal option -o pipefail").
"${COMPOSE[@]}" exec -T openwa-api bash -c 'mkdir -p /app/data/.deploy-backups && BACKUP_DIR=/app/data/.deploy-backups bash /app/scripts/backup.sh'
ARCHIVE="$("${COMPOSE[@]}" exec -T openwa-api sh -c 'ls -1t /app/data/.deploy-backups' | head -n1 | tr -d '\r')"
[ -n "$ARCHIVE" ] || { echo "no se encontró el archivo de backup generado" >&2; exit 1; }

SRC_SIZE="$("${COMPOSE[@]}" exec -T openwa-api stat -c%s "/app/data/.deploy-backups/$ARCHIVE" | tr -d '\r')"

# Verificación explícita: en una corrida real, `docker cp` de un archivo de ~400MB devolvió
# éxito (set -e no abortó) pero el archivo nunca apareció (o quedó incompleto) en destino, sin
# ningún error visible. No confiar en el exit code ni en "no vacío" (un archivo parcial también
# pasa `-s`): comparar el tamaño exacto contra el de origen dentro del contenedor, con reintentos.
ok=0
for attempt in 1 2 3; do
  rm -f "$DEST/$ARCHIVE"
  docker cp "openwa-api:/app/data/.deploy-backups/$ARCHIVE" "$DEST/$ARCHIVE" || true
  GOT_SIZE="$(wc -c < "$DEST/$ARCHIVE" 2>/dev/null || echo 0)"
  if [ "$GOT_SIZE" = "$SRC_SIZE" ] && [ "$GOT_SIZE" -gt 0 ]; then
    ok=1
    break
  fi
  echo "  intento $attempt: docker cp dejó $GOT_SIZE/$SRC_SIZE bytes en $DEST/$ARCHIVE; reintentando ..." >&2
  sleep 3
done
if [ "$ok" -ne 1 ]; then
  echo "ERROR: docker cp no logró copiar el backup completo tras 3 intentos ($DEST/$ARCHIVE, se esperaban $SRC_SIZE bytes). El backup real quedó a salvo en el volumen (/app/data/.deploy-backups/$ARCHIVE dentro del contenedor); rescatalo a mano." >&2
  exit 1
fi
echo "openwa backup ok: $DEST/$ARCHIVE ($GOT_SIZE bytes)"
# Rotación: conservar solo los últimos 5 backups dentro del volumen (no en $DEST, ese lo administra el operador).
"${COMPOSE[@]}" exec -T openwa-api sh -c 'cd /app/data/.deploy-backups && ls -1t | tail -n +6 | xargs -r rm -f --'
REMOTE_EOF

log "  -> Kampro: copiando kampro.sqlite ..."
ssh_remote bash -s -- "$VPS_DIR" "$REMOTE_BACKUP_DIR" <<'REMOTE_EOF'
set -euo pipefail
VPS_DIR="$1"
DEST="$2"
SRC="$VPS_DIR/kampro/data/kampro.sqlite"
if [ ! -f "$SRC" ]; then
  echo "ADVERTENCIA: no se encontró $SRC" >&2
  exit 0
fi
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SRC" ".backup '$DEST/kampro.sqlite'"
else
  echo "ADVERTENCIA: sqlite3 no está instalado en el host; copia simple (puede quedar inconsistente si hay escrituras concurrentes)." >&2
  cp -p "$SRC" "$DEST/kampro.sqlite"
fi
[ -s "$DEST/kampro.sqlite" ] || { echo "ERROR: no quedó $DEST/kampro.sqlite (o quedó vacío)" >&2; exit 1; }
echo "kampro backup ok: $DEST/kampro.sqlite ($(wc -c < "$DEST/kampro.sqlite") bytes)"
REMOTE_EOF

log "  -> Copiando docker-compose.override.yml actual ..."
ssh_remote "cp -p '$VPS_DIR/docker-compose.override.yml' '$REMOTE_BACKUP_DIR/docker-compose.override.yml'"

# ---------------------------------------------------------------------------
# 4. Promover el árbol ya testeado a /opt/openwa (rsync server-side, sin retransferir)
# ---------------------------------------------------------------------------
log "Sincronizando en el VPS (rsync $([ $PRUNE -eq 1 ] && echo 'con --delete' || echo 'sin --delete'))..."
ssh_remote bash -s -- "$VPS_DIR" "$REMOTE_SCRATCH" "$PRUNE" <<'REMOTE_EOF'
set -euo pipefail
VPS_DIR="$1"
SCRATCH="$2"
PRUNE="$3"

EXCLUDES=(
  '--exclude=.env'
  '--exclude=data'
  '--exclude=node_modules'
  '--exclude=.git'
  '--exclude=*.sqlite'
  '--exclude=*.sqlite-journal'
  '--exclude=*.sqlite-wal'
  '--exclude=*.sqlite-shm'
  '--exclude=hotfix'
  '--exclude=backups'
  '--exclude=.last-deploy-sha'
)

RSYNC_ARGS=(-a "${EXCLUDES[@]}")
if [ "$PRUNE" -eq 1 ]; then
  RSYNC_ARGS+=(--delete)
fi

rsync "${RSYNC_ARGS[@]}" "$SCRATCH"/ "$VPS_DIR"/
echo "sync ok"
REMOTE_EOF

# ---------------------------------------------------------------------------
# 5. Kampro: dependencias + schema (siempre db push, nunca migrate)
# ---------------------------------------------------------------------------
if [ "$KAMPRO_CHANGED" -eq 1 ] || [ "$FIRST_DEPLOY" -eq 1 ]; then
  log "Actualizando dependencias y esquema de Kampro ..."
  ssh_remote bash -s -- "$VPS_DIR" <<'REMOTE_EOF'
set -euo pipefail
VPS_DIR="$1"
cd "$VPS_DIR/kampro"
npm ci
npx prisma generate
# db push, NO migrate deploy: este proyecto no tiene prisma/migrations/. Si prisma detecta un
# cambio destructivo, esto falla al no poder pedir confirmación interactiva -- es la señal para
# revisar el cambio a mano, no algo que este script deba forzar con --accept-data-loss.
npx prisma db push
echo "kampro deps+schema ok"
REMOTE_EOF
else
  log "kampro/ sin cambios: se omite npm ci / prisma."
fi

# ---------------------------------------------------------------------------
# 6. Restart
# ---------------------------------------------------------------------------
if [ "$KAMPRO_CHANGED" -eq 1 ] || [ "$FIRST_DEPLOY" -eq 1 ]; then
  log "Reiniciando kampro.service ..."
  ssh_remote "systemctl restart kampro.service"
  sleep 2
  ssh_remote "systemctl is-active --quiet kampro.service" || die "kampro.service no quedó activo tras el restart"
  log "kampro.service activo."
fi

if [ "$ROOT_CHANGED" -eq 1 ] || [ "$FIRST_DEPLOY" -eq 1 ]; then
  log "Reconstruyendo y recreando openwa-api (esto toca la sesión de WhatsApp 'pcc') ..."
  ssh_remote bash -s -- "$VPS_DIR" "$SESSION_ID" <<'REMOTE_EOF'
set -euo pipefail
VPS_DIR="$1"
SESSION_ID="$2"
cd "$VPS_DIR"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.override.yml)

"${COMPOSE[@]}" build openwa-api
"${COMPOSE[@]}" up -d --force-recreate openwa-api

echo "esperando healthy ..."
ok=0
for i in $(seq 1 24); do
  st="$(docker inspect openwa-api --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)"
  echo "t=$i $st"
  if grep -q 'running healthy' <<< "$st"; then ok=1; break; fi
  sleep 5
done
if [ "$ok" -ne 1 ]; then
  echo "openwa-api no quedó healthy" >&2
  "${COMPOSE[@]}" logs --tail 80 openwa-api || true
  exit 1
fi

echo "chequeando sesión $SESSION_ID (sin imprimir la API key) ..."
KEY="$("${COMPOSE[@]}" exec -T openwa-api cat /app/data/.api-key | tr -d '\r\n')"
started=0
for i in $(seq 1 12); do
  STATUS="$(curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:2785/api/sessions/$SESSION_ID" | grep -o '"status":"[a-z_]*"' | head -n1 | cut -d'"' -f4 || true)"
  echo "sesión poll $i: status=$STATUS"
  case "$STATUS" in
    ready|connected|working) echo "sesión OK sin intervención (AUTO_START_SESSIONS)"; break ;;
    qr|failed)
      echo "ALERTA: la sesión pide QR o está failed. NO se reescanea ni se reintenta automáticamente." >&2
      echo "Avisar al operador y seguir .cursor/rules/openwa-vps-headed.mdc manualmente." >&2
      exit 1
      ;;
  esac
  if [ "$i" -eq 6 ] && [ "$started" -eq 0 ]; then
    echo "la sesión no volvió sola tras ~30s: se llama a /start UNA sola vez"
    curl -sS -o /dev/null -w 'start http %{http_code}\n' -X POST -H "X-API-Key: $KEY" "http://127.0.0.1:2785/api/sessions/$SESSION_ID/start"
    started=1
  fi
  sleep 5
done
echo "no tocar Start/Stop de la sesión pcc durante los próximos ~5 minutos."
REMOTE_EOF
else
  log "Sin cambios fuera de kampro/: se omite tocar el contenedor openwa-api / la sesión de WhatsApp."
fi

# ---------------------------------------------------------------------------
# 7. Healthcheck final
# ---------------------------------------------------------------------------
log "Healthcheck final ..."
ssh_remote bash -s -- "$SESSION_ID" <<'REMOTE_EOF'
set -euo pipefail
SESSION_ID="$1"
fail=0

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:2785/health || echo 000)"
echo "OpenWA /health -> $code"
[ "$code" = "200" ] || fail=1

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/health || echo 000)"
echo "Kampro /health -> $code"
[ "$code" = "200" ] || fail=1

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q '^openwa-api$'; then
  COMPOSE=(docker compose -f /opt/openwa/docker-compose.yml -f /opt/openwa/docker-compose.override.yml)
  KEY="$("${COMPOSE[@]}" exec -T openwa-api cat /app/data/.api-key 2>/dev/null | tr -d '\r\n' || true)"
  if [ -n "$KEY" ]; then
    STATUS="$(curl -sS -H "X-API-Key: $KEY" "http://127.0.0.1:2785/api/sessions/$SESSION_ID" | grep -o '"status":"[a-z_]*"' | head -n1 | cut -d'"' -f4 || true)"
    echo "Sesión pcc -> status=$STATUS"
    case "$STATUS" in
      ready|connected|working) : ;;
      *) fail=1 ;;
    esac
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "HEALTHCHECK FALLÓ. No se hace rollback automático de la sesión de WhatsApp. Revisar a mano." >&2
  exit 1
fi
echo "healthcheck ok"
REMOTE_EOF

# ---------------------------------------------------------------------------
# 8. Marcar el deploy como exitoso
# ---------------------------------------------------------------------------
ssh_remote "echo '$TARGET_SHA' > '$VPS_DIR/.last-deploy-sha'"
log "Deploy completo. SHA desplegado: $TARGET_SHA"
