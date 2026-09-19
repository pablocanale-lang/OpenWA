# 04-configuracion-y-entornos.md

> **Propósito:** Variables de entorno, archivos de configuración y diferencias entre entornos.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Variables de entorno de OpenWA

[CONFIRMADO] `.env.example` y `.env.minimal`. Se documentan las más relevantes; la lista completa está en `.env.example`.

| Variable | Descripción | Obligatoria | Ejemplo ficticio | Dónde definir |
|----------|-------------|-------------|------------------|---------------|
| `NODE_ENV` | Modo de ejecución | Sí | `production` | `.env` |
| `PORT` / `API_PORT` | Puerto API y mapeo compose | Sí | `2785` | `.env` |
| `DATABASE_TYPE` | `sqlite` o `postgres` | Sí | `sqlite` | `.env` |
| `DATABASE_NAME` | Nombre DB Postgres o ruta SQLite | Depende | `./data/openwa.sqlite` | `.env` |
| `DATABASE_SYNCHRONIZE` | Auto-sync schema (dev) | Sí | `false` | `.env` |
| `DATABASE_PASSWORD` | Contraseña Postgres | Si `DATABASE_TYPE=postgres` | `(fuerte)` | `.env` |
| `ENGINE_TYPE` | `whatsapp-web.js` o `baileys` | Recomendada | `whatsapp-web.js` | `.env` |
| `PUPPETEER_HEADLESS` | `true`/`false` | VPS: `false` | `false` | `.env` / override |
| `WWEBJS_WEB_VERSION` | Pin de build de WhatsApp Web | Recomendada | `2.3000.1046805918-alpha` | `.env` |
| `PUPPETEER_EXECUTABLE_PATH` | Ruta Chrome en imagen | Docker | `/usr/local/bin/puppeteer-chrome` | `.env` |
| `AUTO_START_SESSIONS` | Reanudar sesiones al arrancar | Sí | `false` | `.env` |
| `MCP_ENABLED` | Activar servidor MCP | No | `true` | `.env` |
| `MCP_READONLY` | Solo lectura en MCP | No | `true` | `.env` |
| `API_MASTER_KEY` | Master API key OpenWA | Sí en prod | `(mínimo 32 chars)` | `.env` |
| `ALLOW_DEV_API_KEY` | Permitir `dev-admin-key` | Solo dev | `true` | `.env` |
| `WEBHOOK_TIMEOUT` | Timeout de webhooks (ms) | No | `10000` | `.env` |
| `REDIS_ENABLED` / `QUEUE_ENABLED` | Redis + cola BullMQ | No | `false` | `.env` |
| `STORAGE_TYPE` | `local` o `s3` | No | `local` | `.env` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credenciales S3 | Si `s3` | `(credenciales)` | `.env` |

## Variables de entorno de Kampro CRM

[CONFIRMADO] `kampro/env.example`.

| Variable | Descripción | Obligatoria | Ejemplo ficticio | Dónde definir |
|----------|-------------|-------------|------------------|---------------|
| `DATABASE_URL` | SQLite de Kampro | Sí | `file:../data/kampro.sqlite` | `kampro/.env` |
| `KAMPRO_API_HOST` | Host de escucha | Sí | `127.0.0.1` | `kampro/.env` |
| `KAMPRO_API_PORT` | Puerto de escucha | Sí | `3100` | `kampro/.env` |
| `KAMPRO_API_KEY` | API key del CRM | Sí en prod | `(fuerte)` | `kampro/.env` |
| `KAMPRO_EXPOSE_UI_KEY` | Exponer key en `/ui/config` | No | `false` | `kampro/.env` |
| `OPENWA_BASE_URL` | URL base del gateway | Sí | `http://127.0.0.1:2785` | `kampro/.env` |
| `OPENWA_API_KEY` | API key de OpenWA | Sí para notificaciones | `(fuerte)` | `kampro/.env` |
| `OPENWA_SESSION_ID` | UUID o nombre de sesión | No | `pcc` | `kampro/.env` |
| `KAMPRO_SALES_GROUP_NAME` | Nombre del grupo de ventas | No | `Kampro Ventas` | `kampro/.env` |
| `KAMPRO_SALES_GROUP_ID` | ID fijo del grupo WhatsApp | No | `...g.us` | `kampro/.env` |

## Archivos de configuración clave

| Archivo | Qué controla |
|---------|--------------|
| `.env` / `kampro/.env` | Secretos y runtime (no versionar). |
| `docker-compose.yml` | Producción OpenWA con perfiles opcionales (postgres, redis, minio). |
| `docker-compose.dev.yml` | Smoke local con SQLite y built-in dashboard. |
| `.cursor/openwa-vps-novnc.override.yml` | Override de producción para noVNC + Chrome headed. |
| `kampro/prisma/schema.prisma` | Esquema SQLite del CRM. |
| `kampro/tsconfig.json` | TypeScript del CRM. |
| `dashboard/vite.config.ts` | Proxy a OpenWA (`/api`) y a Kampro (`/kampro-api`). |

## Diferencias entre entornos

### Desarrollo local

- OpenWA: `npm run dev` en `:2785`; dashboard Vite en `:2886`.
- Kampro: `cd kampro && npm run dev` en `:3100`.
- Base de datos: SQLite con `DATABASE_SYNCHRONIZE=true`.
- `ALLOW_DEV_API_KEY=true` puede usarse con `dev-admin-key`.

### Producción (VPS)

- OpenWA corriendo en Docker con `docker-compose.yml` + override noVNC.
- Dashboard servido como bundle estático por NestJS en `:2785`.
- Kampro como proceso/servicio separado en mismo host.
- `DATABASE_TYPE=postgres` recomendado; `DATABASE_SYNCHRONIZE=false`.
- `PUPPETEER_HEADLESS=false` obligatorio para mantener vinculación.
- No exponer `/mcp` ni noVNC a internet sin proxy/auth.

## .env.example actualizado

El repo ya tiene `.env.example` (OpenWA) y `kampro/env.example`. No se crearon duplicados. Se recomienda:

1. Copiar `.env.example` → `.env` y ajustar.
2. Copiar `kampro/env.example` → `kampro/.env` y ajustar.
3. Nunca subir `.env` ni archivos bajo `data/` al repo (están en `.gitignore`).

[CONFIRMADO] `.gitignore` raíz y `kampro/.gitignore` ignoran `data/`, `.env`, `*.sqlite` y `session-*`.

## Nota de seguridad

[CONFIRMADO] `kampro/src/api/ui.ts` expone `KAMPRO_API_KEY` a través de `/ui/config` a menos que `KAMPRO_EXPOSE_UI_KEY=false`. En producción setear `false` y configurar la key manualmente en el dashboard.
