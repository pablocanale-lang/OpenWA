# CLAUDE.md — Guía de contexto para Kampro CRM sobre OpenWA

> **Propósito:** Puerta de entrada para cualquier colaborador (humano o IA) que abra el repo por primera vez. Resume qué se construyó, cómo se despliega y qué no hay que tocar.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Qué es este proyecto

1. **OpenWA** (`package.json`): gateway de WhatsApp auto-alojado (NestJS + TypeScript). Expone API REST, webhooks, dashboard React y un servidor MCP para agentes de IA.
2. **Kampro CRM** (`kampro/`): capa comercial construida **encima** de OpenWA, no un fork. Gestiona importaciones de China, inventario, pedidos de clientes, pagos, facturas y contabilidad en guaraníes (PYG).
3. Vinculación por **teléfono**: un número nuevo crea un Lead; un número existente actualiza Lead/Cliente.
4. El WhatsApp corporativo de Kampro vive en un VPS y se conecta a OpenWA vía `whatsapp-web.js` con Chrome **con pantalla** (noVNC).

## Stack y comandos esenciales

| Parte | Tecnología | Comandos clave |
|-------|-----------|----------------|
| OpenWA API | Node.js 22 LTS, NestJS 11, TypeScript 6 | `npm ci`, `npm run dev`, `npm run test`, `npm run build:all` |
| OpenWA DB | SQLite (local) / PostgreSQL (prod) | `npm run migration:run` |
| Dashboard | React 19, Vite 8, react-i18next | `cd dashboard && npm ci && npm run dev` |
| Kampro CRM | Fastify 5, Prisma 6, SQLite, Zod | `cd kampro && npm ci`, `npm run dev`, `npm run test` |
| Despliegue | Docker Compose + VPS DigitalOcean | `docker compose -f docker-compose.dev.yml up -d` (OpenWA) |

> Ver detalles de comandos, variables y despliegue en `docs/ai/05-instalacion-ejecucion-y-deploy.md`.

## Mapa de carpetas resumido

```text
openwa/
├── src/                 # Código fuente de OpenWA (NO modificar sin pedido explícito)
├── dashboard/           # SPA React del dashboard de OpenWA
├── kampro/              # CRM propio de Kampro (backend + UI embebida)
│   ├── src/api/         # Rutas Fastify y servidor
│   ├── src/domain/      # Reglas de negocio puras (transiciones, contabilidad, IVA, PEPS)
│   ├── src/services/    # Acceso a Prisma y orquestación
│   ├── prisma/          # Esquema SQLite de productos, pedidos, OC, asientos contables
│   └── public/          # UI vanilla JS para órdenes de compra/importación
├── docs/ai/             # Documentación completa de contexto para migración
├── .cursor/rules/       # Reglas Cursor actuales (migrarán progresivamente a CLAUDE.md)
└── data/                # Volúmenes locales (NO versionar)
```

## Convenciones de código y git

- **Idioma:** dominio de negocio en español; código TypeScript en inglés. Estados y roles son `MAYUSCULAS_CON_GUIONES`.
- **Backend Kampro:** funciones puras en `kampro/src/domain/*`; side-effects en `kampro/src/services/*`. Validaciones con Zod en `kampro/src/api/routes.ts`.
- **Frontend dashboard:** componentes React con hooks de TanStack Query; llamadas al CRM centralizadas en `dashboard/src/services/kamproApi.ts`.
- **Tests:** cada regla de dominio crítica tiene test (`*.test.ts`) ejecutado con `tsx --test`.
- **Commits:** no hay convención estricta aún; usar `feat:`, `fix:`, `docs:` para nuevo trabajo.

## Reglas de oro (no negociables)

1. **Nunca modificar `src/` de OpenWA** salvo que el usuario lo pida expresamente. Kampro es una capa aparte (`kampro/`, `dashboard/`).
2. **No mezclar tablas** de Kampro con las sesiones/mensajes de OpenWA.
3. **No usar Chrome headless en el VPS** para WhatsApp; usar noVNC + `PUPPETEER_HEADLESS=false`. Ver `.cursor/rules/openwa-vps-headed.mdc`.
4. **No inventar políticas de negocio:** descuento 15% solo para 2 unidades; mayorista >8 sin política; flete incluido en precio.
5. **Sin costo de envío cargado no se cierra un pedido** (`kampro/src/domain/order-transitions.ts`).
6. **No versionar secretos ni `data/`:** SQLite, plugins, sesiones y media viven en `data/` y están en `.gitignore`.

## Índice de documentación (`docs/ai/`)

1. [`01-arquitectura.md`](docs/ai/01-arquitectura.md) — componentes, flujo de datos y diagrama.
2. [`02-conexion-instancia-erp.md`](docs/ai/02-conexion-instancia-erp.md) — cómo se conecta el CRM con OpenWA y WhatsApp.
3. [`03-componentes-ia.md`](docs/ai/03-componentes-ia.md) — MCP, modelos y adaptaciones para Claude.
4. [`04-configuracion-y-entornos.md`](docs/ai/04-configuracion-y-entornos.md) — variables de entorno y archivos de config.
5. [`05-instalacion-ejecucion-y-deploy.md`](docs/ai/05-instalacion-ejecucion-y-deploy.md) — arranque local y despliegue.
6. [`06-modelo-de-datos-e-integraciones.md`](docs/ai/06-modelo-de-datos-e-integraciones.md) — entidades e integraciones externas.
7. [`07-historial-y-decisiones.md`](docs/ai/07-historial-y-decisiones.md) — cronología y decisiones de diseño.
8. [`08-estado-actual-y-pendientes.md`](docs/ai/08-estado-actual-y-pendientes.md) — deuda técnica y próximos pasos.
9. [`09-convenciones.md`](docs/ai/09-convenciones.md) — estructura, estilo y tests.
10. [`10-preguntas-abiertas.md`](docs/ai/10-preguntas-abiertas.md) — lo que falta definir.

---

**Contacto funcional:** Las reglas de negocio canónicas de Kampro viven en `.cursor/rules/kampro-crm.mdc` y deben mantenerse como fuente de verdad hasta que se migren formalmente.
