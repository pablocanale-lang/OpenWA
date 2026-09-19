# 06-modelo-de-datos-e-integraciones.md

> **Propósito:** Entidades, relaciones, colas, cachés e integraciones externas del sistema.  
> **Fecha de generación:** 2026-09-19.  
> **Aviso:** Generado a partir del código; revisar con lógica de negocio antes de actuar.

## Base de datos de Kampro CRM

[CONFIRMADO] `kampro/prisma/schema.prisma`. Motor SQLite (`provider = "sqlite"`), archivo definido por `DATABASE_URL`.

### Catálogo e inventario

| Entidad | Campos clave | Reglas de negocio |
|---------|--------------|-------------------|
| `Product` | `sku`, `name`, `capacityMl`, `unitPricePyg`, `stockQty`, `reservedQty`, `status` | Cada variante es un SKU independiente. `availableQty = stockQty - reservedQty`. Costo PEPS en `InventoryLot`. |
| `Supplier` | `name`, `country` (default `CN`), `alibabaUrl` | Proveedores de China. |
| `SupplierProduct` | `supplierId`, `productId` | Relación muchos-a-muchos. |
| `Forwarder` | `name`, `contact`, `country` | Forwarder para importaciones. |

### Importación y abastecimiento

| Entidad | Campos clave | Reglas de negocio |
|---------|--------------|-------------------|
| `PurchaseOrder` | `status` (`BORRADOR`/`CONFIRMADA`/`CERRADA`/`CANCELADA`), `forwarderId`, `supplierId`, `origin`, `destination`, `freight`, `otherCharges`, `fxRateToPyg`, `customsCost`, `dispatchCost` | Editable hasta `CANCELADA`. Al confirmar pago genera asiento a `TRANSITO`. Al cerrar ingresa a inventario al costo landed. |
| `PurchaseOrderLine` | `purchaseOrderId`, `productId`, `quantity`, `unitPrice` | Líneas de la OC. |
| `PurchaseOrderInvoice` | `invoiceNumber`, `ruc`, `legalName`, `issuedAt`, `amount` | Facturas locales cargadas al cerrar. |
| `Shipment` | `reference`, `forwarderId`, `status` (`COORDINADO`/`EN_TRANSITO`/`LLEGADO`/`RECEPCIONADO`) | Agrupa compras en un envío. |
| `Purchase` | `purchasedAt`, `productId`, `supplierId`, `quantity`, `unitPrice`, `currency`, `fxRateToPyg` | Compra individual (histórico/costo). |
| `ImportCost` | `shipmentId`, `type` (`LOGISTICA`/`ADUANA`/`IMPUESTO`/`OTRO`), `amount`, `currency`, `fxRateToPyg` | Costos adicionales prorrateables por envío. |
| `Reception` / `ReceptionIncident` | `receivedQty`, `receivedAt`, `type` (`FALTANTE`/`SOBRANTE`/`DANADO`/`OTRO`) | Recepción física con incidentes. |

### Ventas

| Entidad | Campos clave | Reglas de negocio |
|---------|--------------|-------------------|
| `Order` | `zone` (`ASUNCION`/`INTERIOR`), `status`, `customerPhone`, `recipientName`, `invoiceName`, `ruc`, `totalAmount`, `shippingCostPyg`, `invoiceNumber` | Delivery (Asunción) vs encomienda (Interior). Cierra con costo de envío obligatorio. |
| `OrderLine` | `orderId`, `sku`, `quantity`, `unitPricePyg`, `discountApplied`, `lineTotal` | Descuento 15% automático solo si `quantity === 2`. |
| `Payment` | `orderId`, `amount`, `method` (`EFECTIVO`/`TRANSFERENCIA`), `status` (`CONFIRMADO`/`REEMBOLSADO`) | Cobros parciales permitidos. |
| `InvoiceSequence` | `nextNumber`, `issuer` | Numerador de facturas timbrado 001-001-NNNNNNN. |
| `ChatFollowUp` | `sessionId`, `chatId` | Chats marcados para seguimiento. |

### Contabilidad

| Entidad | Campos clave | Reglas de negocio |
|---------|--------------|-------------------|
| `Account` | `code`, `name`, `type`, `role` (`CAJA`, `BANCO`, `CXC`, `IVA_CREDITO`, etc.) | Plan de cuentas con roles obligatorios. |
| `JournalEntry` | `number`, `numberLabel`, `datedAt`, `memo`, `sourceType`, `sourceId`, `event`, `cashFlow` | Asientos con doble partida. |
| `JournalLine` | `entryId`, `accountId`, `debit`, `credit` | Líneas; deben balancearse. |
| `Expense` | `kind`, `datedAt`, `description`, `amountGrossPyg`, `ivaTreatment`, `treasury` | Gastos con IVA incluido/adicional. |
| `InventoryLot` / `LotConsumption` | `productId`, `purchaseOrderId`, `qtyOriginal`, `qtyRemaining`, `unitCostPyg` | Costo de salida PEPS. |

### Secuencias

- `InvoiceSequence`: facturas.
- `OperationSequence`: referencias de operación (ORDER, PAYMENT, PURCHASE_ORDER).
- `JournalSequence`: asientos contables.

## Colas y cachés

- **BullMQ / Redis:** opcional en OpenWA (`REDIS_ENABLED`, `QUEUE_ENABLED`). No usado por Kampro.
- **Caché en memoria:** dashboard usa TanStack Query para cachear llamadas a Kampro.
- **No hay caché distribuido** para Kampro; todo es lectura directa a SQLite.

## Integraciones externas

| Sistema | Tipo | Uso | Ruta/código |
|---------|------|-----|-------------|
| WhatsApp | Protocolo `whatsapp-web.js` | Envío/recepción de mensajes | OpenWA `src/engine/adapters/` |
| OpenWA API | REST interna | Notificaciones de pedidos a grupo | `kampro/src/services/openwa.service.ts` |
| Meta Ads | Fuente de leads | [PENDIENTE] No hay integración aún. |
| Banco UENO | Conciliación bancaria | Referenciado en scripts de ajuste (`kampro/scripts/reimpute-banco-ueno.ts`). |
| Sistema fiscal | Facturación electrónica | [PENDIENTE] Emisor actual: Pablo Canale; formato 001-001-NNNNNNN. |

## Restricciones de integridad notables

- No se permite stock negativo en recepciones ni ventas PEPS sin existencia.
- Facturas duplicadas rechazadas (`kampro/src/services/invoice.service.ts`).
- Cierre de pedido exige `shippingCostPyg` cargado.
- Cancelación de OC pagada exige registrar devolución del dinero.
