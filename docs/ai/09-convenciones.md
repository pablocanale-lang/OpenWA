# 09-convenciones.md

> **Propósito:** Convenciones de código, estructura, errores, logs, tests y estilo de commits/ramas.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Estructura de código

### Kampro CRM

[CONFIRMADO] `kampro/src/`.

```text
kampro/src/
├── api/        # Fastify: rutas, auth, UI estática
├── domain/     # Funciones puras y reglas de negocio
├── services/   # Side-effects con Prisma y orquestación
├── db.ts       # PrismaClient
├── money.ts    # Decimal helpers
└── http-error.ts  # HttpError / badRequest / notFound
```

- **Dominio:** funciones puras, sin imports de Prisma ni `db.ts`.
- **Servicios:** único lugar que usa `prisma` y realiza transacciones.
- **API:** valida con Zod y delega a servicios.

### Dashboard

[CONFIRMADO] `dashboard/src/`.

- `pages/` → pantallas React (Orders, Accounting, Kampro importaciones).
- `components/chats/` → paneles de pedido dentro del chat.
- `services/kamproApi.ts` → único lugar de llamadas al CRM.
- `utils/orderPricing.ts` → helpers de moneda compartidos con el backend.
- `i18n/locales/*.json` → traducciones (es, en, etc.); se agregaron claves `kampro`, `orders`, `accounting`.

## Nombres

- **Dominio:** estados, zonas, roles contables en `MAYUSCULAS_CON_GUIONES` (`PENDIENTE_DE_PAGO`, `CAJA`, `IVA_CREDITO`).
- **Base de datos:** tablas en `PascalCase`, campos en `camelCase`.
- **Funciones puras:** verbo + sustantivo (`assertOrderTransition`, `splitIva11`, `consumeFifo`).
- **Servicios:** CRUD + dominio (`orders.service.ts`, `accounting.service.ts`).

## Manejo de errores

[CONFIRMADO] `kampro/src/api/auth.ts`, `kampro/src/http-error.ts`.

- Dominio lanza `Error` con mensaje en español.
- Servicios usan `badRequest()` / `notFound()` para HTTP.
- API convierte:
  - `ZodError` → 400 con `details: err.flatten()`.
  - `HttpError` → statusCode correspondiente.
  - Otros → 500 con mensaje.

## Logging

- OpenWA: logs estructurados vía NestJS; formato configurable con `LOG_FORMAT`.
- Kampro: `console.log`/`console.warn` básicos; no hay logger inyectado.
- No enviar logs con PII a sistemas externos sin ofuscación.

## Tests

[CONFIRMADO] `kampro/package.json`.

```bash
cd kampro
npm run test
```

Ejecuta tests de dominio con `tsx --test`:

- `landed-cost.test.ts`
- `order-pricing.test.ts`
- `order-transitions.test.ts`
- `order-fields.test.ts`
- `sales-notify.test.ts`
- `stock.test.ts`
- `invoice-number.test.ts`
- `purchase-orders.test.ts`
- `business-report.test.ts`
- `iva.test.ts`
- `fifo.test.ts`
- `journal.test.ts`
- `chart-of-accounts.test.ts`
- `accounting-posting.test.ts`
- `pyg-input.test.ts`
- `operation-number.test.ts`

### Cobertura de OpenWA

[CONFIRMADO] `package.json` jest thresholds.

- Global: branches 61%, functions 70%, lines 68%, statements 67%.
- Algunos módulos tienen umbrales superiores (`common/security`, `config`, `queue`, etc.).

## Estilo de commits y ramas

- No hay convención estricta aún. Se recomienda adoptar:
  - `feat(kampro): ...`
  - `fix(openwa): ...`
  - `docs: ...`
  - `refactor(kampro): ...`
- Ramas: `feature/`, `fix/`, `docs/`.
- Este trabajo se creó en rama `docs/contexto-ia`.

## Prettier / ESLint

- OpenWA: `prettier --write "src/**/*.ts" "test/**/*.ts" "**/*.md"`; `eslint "{src,apps,libs,test}/**/*.ts"`.
- Dashboard: `eslint .` y `prettier --write "src/**/*.{ts,tsx,css}"`.
- Kampro: sin lint script propio; TypeScript con `tsc --noEmit`.

## Reglas de negocio inmutables (no improvisar)

[CONFIRMADO] `.cursor/rules/kampro-crm.mdc`.

- 15% de descuento **solo** para 2 unidades.
- Precio siempre incluye envío.
- Encomienda (Interior): pago 100% anticipado antes de despachar.
- Delivery (Asunción): admite contraentrega.
- Toda venta se factura.
- Cerrar pedido exige costo de envío cargado (0 si no hubo gasto).
