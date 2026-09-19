# 05-instalacion-ejecucion-y-deploy.md

> **Propósito:** Pasos para instalar, correr en local, testear y desplegar el sistema.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Requisitos previos

- Node.js ≥ 22.13 LTS.
- npm 10+.
- Docker + Docker Compose (para despliegue OpenWA).
- SQLite (incluido) o PostgreSQL.
- Para desarrollo de importaciones: Chrome/Chromium local si se usa `whatsapp-web.js`.

## Instalación desde cero

### 1. Clonar e instalar OpenWA

```bash
git clone https://github.com/rmyndharis/OpenWA.git
cd OpenWA
npm ci
```

### 2. Instalar dashboard

```bash
npm run dashboard:install   # o cd dashboard && npm ci
```

### 3. Instalar Kampro CRM

```bash
cd kampro
npm ci
npx prisma generate
```

### 4. Crear archivos de entorno

```bash
cp .env.example .env
cp kampro/env.example kampro/.env
```

Ajustar al menos:

- OpenWA: `NODE_ENV`, `DATABASE_TYPE`, `DATABASE_NAME`, `API_MASTER_KEY` o `ALLOW_DEV_API_KEY=true`.
- Kampro: `DATABASE_URL`, `KAMPRO_API_KEY`, `OPENWA_BASE_URL`, `OPENWA_API_KEY`.

## Correr en local

### Opción A: completo (API + dashboard Vite + Kampro)

```bash
# Terminal 1: OpenWA API + dashboard con hot reload
npm run dev

# Terminal 2: Kampro CRM
cd kampro
npm run dev
```

- Dashboard: `http://localhost:2886`
- OpenWA API: `http://localhost:2785/api`
- Kampro API: `http://localhost:3100`

### Opción B: Docker smoke (solo OpenWA)

```bash
docker compose -f docker-compose.dev.yml up -d
```

- Acceso: `http://localhost:2785`

### Opción C: producción ligera local

```bash
npm run build:all
npm run start:prod
```

## Correr tests

```bash
# OpenWA
npm run test

# Kampro (dominio)
cd kampro
npm run test

# Dashboard (tests unitarios)
cd dashboard
npm run test
```

[CONFIRMADO] Scripts en `package.json`, `kampro/package.json`, `dashboard/package.json`.

## Deploy en VPS (OpenWA + Kampro)

### 1. OpenWA con Docker Compose

```bash
# Producción básica SQLite
docker compose up -d

# Con Postgres/Redis/MinIO
docker compose --profile full up -d
```

### 2. Override noVNC para Chrome headed

Aplicar en `/opt/openwa/docker-compose.override.yml` (no publicar `6080` en `0.0.0.0`):

```yaml
services:
  novnc:
    image: theasp/novnc:latest
    ports:
      - '127.0.0.1:6080:8080'
    # ... (ver .cursor/openwa-vps-novnc.override.yml)
  openwa-api:
    environment:
      - DISPLAY=novnc:0.0
      - PUPPETEER_HEADLESS=false
      - HOME=/home/openwa
    tmpfs:
      - /tmp
      - /home/openwa:uid=997,gid=997,mode=700
```

[CONFIRMADO] `.cursor/openwa-vps-novnc.override.yml`.

### 3. Vincular sesión WhatsApp

1. Arrancar OpenWA.
2. Abrir túnel SSH para noVNC: `ssh -L 6080:127.0.0.1:6080 <vps>`.
3. Ir a `http://127.0.0.1:6080/vnc.html?autoconnect=1`.
4. En el dashboard, iniciar sesión `pcc` y escanear QR **una sola vez**.
5. Esperar ~5 min sin tocar Start/Stop.

### 4. Desplegar Kampro CRM

[CONFIRMADO] Relevado en el VPS el 2026-09-19. Kampro corre como **servicio systemd** (no Docker,
no pm2), definido en `/etc/systemd/system/kampro.service`:

```ini
[Unit]
Description=Kampro CRM
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/openwa/kampro
EnvironmentFile=/opt/openwa/kampro/.env
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

- `systemctl restart kampro.service` aplica un cambio de código. `systemctl status kampro.service`
  para ver logs recientes (también quedan en `journalctl -u kampro`).
- El código llega a `/opt/openwa` **sin git** (no hay `.git` en el servidor): se sincroniza por
  copia (rsync/scp), no por `git pull`. Ver `scripts/deploy-vps.sh`.
- Kampro no tiene `prisma/migrations/`; el esquema se aplica con `npx prisma db push` (nunca
  `migrate deploy`, que fallaría sin historial de migraciones — ver
  `10-preguntas-abiertas.md`).
- `kampro/data/kampro.sqlite` vive en el filesystem del host (no en un volumen Docker). Ya hay
  backups manuales ad-hoc en `kampro/data/backups/kampro.sqlite.pre-<cambio>-<fecha>`.

Asegurar que:

- `OPENWA_BASE_URL` apunte al OpenWA local.
- `KAMPRO_API_KEY` y `OPENWA_API_KEY` estén seteados.
- El dashboard pueda llegar a Kampro (proxy inverso o red Docker compartida).

### 5. Nota sobre los datos de OpenWA en producción

[CONFIRMADO] A diferencia de lo que sugiere este documento más arriba, en el VPS **no existe**
`/opt/openwa/data` como carpeta del host: `openwa.sqlite`, `main.sqlite`, la sesión de WhatsApp
(`sessions/`, LocalAuth de `pcc`), `media/` y `plugins/` viven dentro de un **volumen Docker con
nombre** (`openwa_openwa-data`) montado en `/app/data` dentro del contenedor `openwa-api`. Un
backup del host no ve esos archivos; hay que entrar al volumen (`docker exec`/`docker cp`) o
correr `scripts/backup.sh` **dentro** del contenedor (que ya resuelve todo esto correctamente).
`DATABASE_TYPE` está comentado en el `.env` de producción → SQLite por defecto; no hay contenedor
de Postgres corriendo pese a que este documento lo recomienda para producción.

### 6. Script de deploy automatizado

[CONFIRMADO] `scripts/deploy-vps.sh` (2026-09-19) automatiza: tests locales → backup remoto
(OpenWA vía `scripts/backup.sh` dentro del contenedor + `kampro.sqlite` + `docker-compose.override.yml`)
→ sync de código (`git archive` + `scp` + `rsync` del lado remoto, protegiendo `.env`,
`kampro/.env`, `data/`, `node_modules/`, `.git/`, `*.sqlite*`, y **`hotfix/`** — un parche
solo-servidor, no versionado en este repo, que mantiene `READY_RECONCILE_TIMEOUT_MS=300_000` y
evita la recarga de WhatsApp Web a mitad de sync; ver `.cursor/rules/openwa-vps-headed.mdc`) →
`prisma db push` en Kampro si cambió → `systemctl restart kampro.service` y/o reconstrucción del
contenedor `openwa-api` (solo si hay cambios fuera de `kampro/`) → healthcheck de `/health` de
ambos servicios y del estado de la sesión `pcc`. No borra archivos en el servidor salvo que se
pase `--prune` explícitamente, y nunca hace rollback automático de la sesión de WhatsApp.

## Pasos manuales no automatizados

- Crear productos iniciales en Kampro (los SKUs del negocio).
- Configurar plan de cuentas base (`kampro/src/domain/chart-of-accounts.ts` se inicializa automáticamente en `server.ts`).
- Seed/demo: `cd kampro && npm run db:seed` o `db:seed:demo`.
- Corregir saldos iniciales contables vía asientos manuales (`POST /accounting/manual`).
- Definir grupo de ventas de WhatsApp (`KAMPRO_SALES_GROUP_NAME` o `KAMPRO_SALES_GROUP_ID`).
