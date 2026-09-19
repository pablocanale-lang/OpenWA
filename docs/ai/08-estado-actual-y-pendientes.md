# 08-estado-actual-y-pendientes.md

> **Propósito:** Qué funciona, qué está a medias, qué está roto y próximos pasos priorizados.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Qué funciona

[CONFIRMADO] Basado en archivos de dominio, tests y servicios.

- **Catálogo y stock:** SKUs, stock físico, reservas, ajustes, movimientos.
- **Importaciones:** crear/confirmar/cerrar/cancelar órdenes de compra; facturas de importación; costo landed.
- **Pedidos de clientes:** creación por zona (Asunción/Interior), transiciones, pagos, cancelaciones/devoluciones.
- **Facturación:** numeración 001-001-NNNNNNN, emisor Pablo Canale.
- **Contabilidad:** plan de cuentas con roles, asientos automáticos (venta, cobro, CMV, envío, OC, gastos), estados financieros.
- **Notificaciones a grupo de ventas** por WhatsApp al crear pedido Asunción y al confirmar pago Interior.
- **Dashboard:** paneles de pedidos, contabilidad, importaciones y stock integrados.
- **Tests de dominio:** transiciones, IVA, PEPS, asientos, journal, etc.

## Qué está a medias

- **Lead/Cliente formal:** existe el modelo mental en `.cursor/rules/kampro-crm.mdc`, pero no hay tablas `Lead` ni `Customer` aún. Los pedidos guardan `customerPhone`, `recipientName` y `invoiceName` directamente.
- **Facturación electrónica:** se guarda número, emisor y fecha, pero no hay integración con sistema fiscal.
- **Integración Meta Ads:** no hay captación automática de leads ni métricas.
- **Cancelaciones/devoluciones completas:** el código revierte stock y contabilidad, pero la política de reembolso total y estados `DEVUELTO` es parcial.
- **Mayorista >8 unidades:** sin política comercial ni descuentos.
- **Automatización de chat:** no hay bot/IA respondiendo mensajes; todo es operador humano vía dashboard.

## Qué está roto / deuda técnica

- **Mensajes de commit inútiles:** la historia local (`asd`, `asdasd`, `ssss`) no permite auditar cambios.
- **Mezcla de UI technologies:** importaciones en vanilla JS, pedidos/contabilidad en React. Duplica lógica de render y estilos.
- **Dependencia de configuración manual del VPS:** no hay IaC ni scripts de despliegue automatizado para Kampro.
- **API key expuesta por defecto:** `kampro/src/api/ui.ts` sirve la key a menos que `KAMPRO_EXPOSE_UI_KEY=false`.
- **SQLite en producción:** sin backup/replicación documentado; riesgo de corrupción por concurrencia.
- **No hay observabilidad de Kampro:** solo `console.warn` en notificaciones fallidas.
- **Falta validación de RUC paraguayo real:** solo se sanitiza a dígitos y guiones (`kampro/src/domain/order-fields.ts`).

## TODO / FIXME encontrados

[CONFIRMADO] Búsqueda `TODO|FIXME|HACK|XXX` en `kampro/`. Solo apareció uno explícito:

- `kampro/prisma/schema.prisma:31` — `/// TODO negocio: criterio de reposición. No usar todavía.`

[PENDIENTE] La regla de negocio `.cursor/rules/kampro-crm.mdc` lista muchos `TODO de negocio` que deben resolverse fuera del código (ver `10-preguntas-abiertas.md`).

## Próximos pasos sugeridos (priorizados)

1. **Definir entidades Lead y Customer** y migrar datos de pedidos existentes.
2. **Documentar/desplegar Kampro en VPS** (systemd/Docker) con `.env` de producción.
3. **Resolver TODO de negocio:** direcciones de delivery Asunción, proveedor local, agencias de encomienda, verificación de transferencias.
4. **Agregar backup automático** de `data/kampro.sqlite`.
5. **Unificar UI de importaciones** dentro del dashboard React.
6. **Implementar webhook** de OpenWA hacia Kampro para crear leads automáticamente.
7. **Agregar rate limiting/retry** en llamadas Kampro → OpenWA.
8. **Estandarizar mensajes de commit** para nuevos cambios.
