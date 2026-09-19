# 07-historial-y-decisiones.md

> **Propósito:** Cronología de cambios grandes y decisiones de diseño documentadas.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir de `git log`, el estado del working tree y reglas de negocio; revisar.

## Cronología reconstruida desde git

[CONFIRMADO] `.git/logs/HEAD`. El repo se clonó desde `https://github.com/rmyndharis/OpenWA.git`; los commits locales tienen mensajes poco descriptivos (`asd`, `asdasd`, `contable`, `cambios de modulos`, etc.).

| Fecha aprox. | Commit mensaje | Qué se construyó (según diff y archivos) |
|--------------|----------------|------------------------------------------|
| Sep 2026 | clone | Clon base de OpenWA v0.23.3. |
| Sep 2026 | `cambios de modulos` | Inicio del CRM Kampro: dominio, servicios, esquema Prisma básico. |
| Sep 2026 | `contable` | Plan de cuentas, asientos, journal, IVA, estados financieros. |
| Sep 2026 | `solucion de problemas` | Ajustes en transiciones de pedidos, stock, reservas. |
| Sep 2026 | `Keep WhatsApp first-link from aborting mid-sync.` | Hotfix para evitar recarga del puente WWebJS durante sync; documentado en `.cursor/rules/openwa-vps-headed.mdc`. |
| Sep 2026 | `ultimas modifficaciones` | Panel de pedidos en dashboard React (`OrderQuickPanel`, `OrderCurrentTab`), locales i18n, página `Accounting`. |

[INFERIDO] Los mensajes de commit no describen el trabajo; la cronología se inferió del estado final del árbol.

## Decisiones de diseño importantes

### 1. CRM como capa aparte sobre OpenWA

- **Contexto:** Kampro necesita persistencia propia sin contaminar el core de OpenWA.
- **Decisión:** Crear `kampro/` con su propia base SQLite, API Fastify y UI vanilla; integrar paneles React dentro del dashboard de OpenWA.
- **Alternativas descartadas:** [PENDIENTE] Fork de OpenWA o plugin sandbox.
- **Motivo:** Facilitar upgrades de OpenWA y mantener separación de responsabilidades.

### 2. Motor WhatsApp: `whatsapp-web.js` en lugar de Baileys

- **Contexto:** Se necesita conservar historial de mensajes si el VPS se apaga.
- **Decisión:** Usar `whatsapp-web.js` con Chrome real (headed) y noVNC.
- **Alternativa descartada:** Baileys (no guarda historial ante apagones).
- **Motivo:** Documentado en `.cursor/rules/openwa-vps-headed.mdc`.

### 3. SQLite para Kampro

- **Contexto:** Simplicidad de despliegue en VPS compartido.
- **Decisión:** SQLite con Prisma.
- **Alternativas descartadas:** PostgreSQL separado.
- **Motivo:** [PENDIENTE] Probablemente simplicidad operativa; crecerá con el negocio.

### 4. Contabilidad en moneda funcional PYG con IVA incluido

- **Contexto:** Paraguay, IVA 10% incluido en precios.
- **Decisión:** Precios brutos en guaraníes; IVA extraído dividiendo ÷11.
- **Alternativas descartadas:** [PENDIENTE]
- **Motivo:** `kampro/src/domain/iva.ts` implementa la regla fiscal local.

### 5. Costo de salida PEPS

- **Contexto:** Necesidad de valorar inventario de importaciones.
- **Decisión:** `InventoryLot` ordenado por `receivedAt`; consumo primero el lote más antiguo.
- **Alternativas descartadas:** Promedio ponderado.
- **Motivo:** `kampro/src/domain/fifo.ts`.

### 6. Descuento automático solo 2 unidades

- **Contexto:** Política comercial definida por el negocio.
- **Decisión:** 15% automático exclusivamente si `quantity === 2`; 1 o 3-8 quedan 0.
- **Alternativas descartadas:** Escalas variables.
- **Motivo:** `.cursor/rules/kampro-crm.mdc` y `kampro/src/domain/order-pricing.ts`.

### 7. Separar UI de importaciones (vanilla) del dashboard React

- **Contexto:** Dashboard React ya existe; gestión de OC se desarrolló rápido.
- **Decisión:** UI vanilla en `kampro/public/` servida por Fastify; pedidos/contabilidad en React.
- **Alternativas descartadas:** Migrar todo a React de inmediato.
- **Motivo:** [PENDIENTE] Probablemente velocidad de desarrollo.
