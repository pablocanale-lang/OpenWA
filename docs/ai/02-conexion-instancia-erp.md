# 02-conexion-instancia-erp.md

> **Propósito:** Documentar cómo se conecta el CRM con OpenWA y con la instancia de WhatsApp en producción.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Tipo de integración

Kampro CRM no se conecta a un ERP externo: **es la capa de ERP** que se despliega junto a OpenWA. La única integración viva es con el gateway WhatsApp de OpenWA mediante su API REST.

- **Dirección:** Kampro API → OpenWA API (llamadas salientes para enviar notificaciones).
- **Dirección inversa:** Dashboard OpenWA → Kampro API (llamadas desde el panel de pedidos y contabilidad).
- **No hay webhooks** de OpenWA hacia Kampro por ahora; el dashboard lee pedidos filtrando por teléfono/chat.

## Endpoints y métodos usados

### Kampro → OpenWA (notificaciones)

[CONFIRMADO] `kampro/src/services/openwa.service.ts`

| Método | Endpoint | Propósito |
|--------|----------|-----------|
| GET | `/api/sessions?limit=1000` | Listar sesiones disponibles. |
| GET | `/api/sessions/:id/groups?limit=1000` | Buscar grupo de ventas. |
| POST | `/api/sessions/:id/messages/send-text` | Enviar aviso de pedido nuevo/pago confirmado al grupo. |

### Dashboard → Kampro

[CONFIRMADO] `dashboard/src/services/kamproApi.ts`

| Recurso | Verbos | Propósito |
|---------|--------|-----------|
| `/health` | GET | Healthcheck. |
| `/products` | GET/POST/PATCH | Catálogo de SKUs. |
| `/orders` | GET/POST/PATCH/transition | Pedidos de clientes. |
| `/purchase-orders` | GET/POST/PATCH/confirm/close/cancel | Órdenes de compra/importación. |
| `/accounting/*` | GET/POST | Plan de cuentas, asientos, libro mayor, estados financieros, gastos. |
| `/ui/config` | GET | Bootstrap automático de API key. |

## Autenticación

- **OpenWA API:** API key en header `X-API-Key` o `Authorization: Bearer`. Configurada en `OPENWA_API_KEY` (Kampro) y en el dashboard mediante bootstrap.
- **Kampro API:** API key en header `X-API-Key` mediante `KAMPRO_API_KEY`.
- **Dashboard:** usa `bootstrapKamproKey()` para leer la key desde `/ui/config` si `KAMPRO_EXPOSE_UI_KEY !== 'false'`. [CONFIRMADO] `kampro/src/api/ui.ts`.

## Entornos

| Entorno | OpenWA | Kampro API | Dashboard | Observaciones |
|---------|--------|------------|-----------|---------------|
| Local dev | `http://127.0.0.1:2785` | `http://127.0.0.1:3100` | `http://localhost:2886` | SQLite, hot reload. |
| VPS producción | `https://app.kampro.store` / proxy inverso | mismo host, puerto interno | bundle servido por OpenWA en `:2785` | Sesión `pcc`, Chrome con noVNC. |

[INFERIDO] La URL pública del dashboard es `https://app.kampro.store` según `.cursor/rules/openwa-vps-headed.mdc`. El host del VPS es DigitalOcean; IP y credenciales están fuera del repo.

## Sesión de WhatsApp en producción

[CONFIRMADO] `.cursor/rules/openwa-vps-headed.mdc`:

- Sesión canónica: `pcc` (UUID en config del VPS; reemplazó a `pablo`).
- Motor: `whatsapp-web.js` (necesario para conservar historial ante apagones).
- PushName del número: **Kampro**.
- Configuración crítica: `PUPPETEER_HEADLESS=false`, no usar `WWEBJS_WEB_VERSION=off`, no recargar WhatsApp Web a mitad de sync.
- Acceso visual: túnel SSH `ssh -L 6080:127.0.0.1:6080 …` → `http://127.0.0.1:6080/vnc.html`.

## Modelos y tablas del ERP propias

No se leen/escriben tablas de OpenWA. Las tablas propias de Kampro están en `kampro/prisma/schema.prisma`:

- `Product`, `Supplier`, `Forwarder`, `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderInvoice`
- `Order`, `OrderLine`, `Payment`
- `Account`, `JournalEntry`, `JournalLine`, `Expense`, `InventoryLot`, `LotConsumption`
- `InvoiceSequence`, `OperationSequence`, `JournalSequence`
- `ChatFollowUp`

## Tareas programadas / cron

No hay cron jobs declarados en el código. Existen scripts de migración/ajuste bajo `kampro/scripts/` que se corren a demanda:

- `kampro/scripts/import-historico.ts`
- `kampro/scripts/import-gastos.ts`
- `kampro/scripts/restore-honorarios.ts`
- `kampro/scripts/settle-iva-agosto.ts`
- `kampro/scripts/reimpute-banco-ueno.ts`
- `kampro/scripts/post-capital-aportes.ts`

[INFERIDO] Estos scripts parecen ser correcciones contables puntuales; no están automatizados.

## Límites conocidos

- Rate limiting de OpenWA configurable por `RATE_LIMIT_*`; el CRM no implementa retries exponenciales para notificaciones.
- Timeout de webhooks por defecto `WEBHOOK_TIMEOUT=10000` ms.
- Paginación de OpenWA: `limit=1000` usado en listado de sesiones/grupos; puede fallar si hay más.
- MCP server de OpenWA monta 25 tools read-only por defecto (`MCP_READONLY=true`).
