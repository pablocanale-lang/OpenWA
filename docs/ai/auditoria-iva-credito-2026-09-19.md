# Auditoría de solo lectura — corrección de gastos Meta Ads y saldo IVA Crédito Fiscal

> **Fecha:** 2026-09-19. Solo lectura. Verificado contra una copia **fresca** de `kampro.sqlite`
> traída por SSH directamente de `/opt/openwa/kampro/data/kampro.sqlite` en el momento de esta
> auditoría (no una copia vieja de sesiones anteriores). **No se modificó código ni datos.**
> Libro general verificado: 117 asientos, débito=crédito=94.049.853 Gs — balanceado.

## Parte 1 — Verificación de la corrección de gastos Meta Ads

### 1. Los 12 `Expense` de Meta Ads/Facebook Ads, contra la tabla aprobada en `docs/ai/auditoria-gastos-talonario-2026-09-19.md`

| Registro | Fecha | Monto viejo | Monto nuevo (producción) | ¿Coincide con lo aprobado? | `ivaTreatment` |
|---|---|---:|---:|---|---|
| G-000007 | 2026-08-04 | 12.150 (neto) | 13.365 | ✅ | EXENTA |
| G-000008 | 2026-08-05 | 12.150 (neto) | 13.365 | ✅ | EXENTA |
| G-000009 | 2026-08-06 | 11.980 (neto) | 13.178 | ✅ | EXENTA |
| G-000010 | 2026-08-10 | 11.980 (neto) | 13.178 | ✅ | EXENTA |
| G-000011 | 2026-08-10 | 22.344 (neto) | 24.578 | ✅ | EXENTA |
| G-000012 | 2026-08-13 | 26.942 (neto) | 29.636 | ✅ | EXENTA |
| G-000013 | 2026-08-17 | 38.581 (neto) | 42.439 | ✅ | EXENTA |
| G-000014 | 2026-08-24 | 48.670 (neto) | 53.537 | ✅ | EXENTA |
| G-000015 | 2026-08-27 | 35.825 (neto) | 39.408 | ✅ | EXENTA |
| G-000017 | 2026-09-08 | 48.670 (neto) | 53.537 | ✅ | EXENTA |
| G-000022 | 2026-09-12 | 48.670 | 53.537 | ✅ | EXENTA |
| G-000028 | 2026-09-17 | 42.806 | 47.087 | ✅ | EXENTA |

`G-000027` (el duplicado fantasma de 47.087) **ya no existe** en producción — eliminado correctamente.

### 2. Asientos vinculados

Para los 12 registros: el asiento (`A-000063`…`A-000117`) balancea, el monto de la línea de Tesorería coincide exacto con `amountGrossPyg`, y **ninguno tiene ya una línea apuntando a la cuenta de rol `IVA_CREDITO`**. Verificado uno por uno, no por muestreo.

### 3. Registros que quedaron afuera

**Ninguno.** No hay ningún `Expense` de Meta Ads/Facebook Ads cargado después de la corrección (el más reciente sigue siendo `G-000028`, 2026-09-17) — no hubo oportunidad de repetir el error todavía.

### 4. Verificación en servidor vs. local

**Verificado directamente contra producción.** Traje una copia de `/opt/openwa/kampro/data/kampro.sqlite` por SSH en el momento de escribir este reporte (no reutilicé ninguna copia de sesiones anteriores) — la corrección de gastos **ya está aplicada en el VPS real**, no solo en el diseño/dry-run.

## Parte 2 — Saldo de IVA Crédito Fiscal (Gs. 618.763)

### 1. Cuenta

Una sola cuenta con rol `IVA_CREDITO`: **`1.1.05` "IVA crédito fiscal"** (el schema fuerza `role` único por cuenta, así que no puede haber otra).

### 2 y 3. Todas las líneas históricas y el total

**Confirmado: el saldo neto da exactamente Gs. 618.763** (débito 1.282.884 − crédito 664.121). Se explica al 100% por estas líneas — no hay ningún otro origen ni descuadre:

| Asiento | Fecha | Origen | Monto (débito) | Memo |
|---|---|---|---:|---|
| A-000013 | 2026-05-04 | `ORDER:IVA_RET` → Pedido PV-000002 | 162.909 | Retención IVA PV-000002 |
| A-000023 | 2026-07-20 | `ORDER:IVA_RET` → Pedido PV-000005 | 285.091 | Retención IVA PV-000005 |
| A-000050 | 2026-08-17 | `ORDER:IVA_RET` → Pedido PV-000013 | 162.909 | Retención IVA PV-000013 |
| A-000041 | 2026-08-17 | `ORDER:SHIPPING` → Pedido PV-000010 | 2.273 | Flete venta PV-000010 |
| A-000048 | 2026-08-14 | `ORDER:SHIPPING` → Pedido PV-000012 | 2.273 | Flete venta PV-000012 |
| A-000079 | 2026-09-12 | `ORDER:SHIPPING` → Pedido PV-000016 | 2.873 | Flete venta PV-000016 |
| A-000099 | 2026-09-14 | `ORDER:SHIPPING` → Pedido PV-000017 | 145 | Flete venta PV-000017 |
| A-000106 | 2026-09-17 | `ORDER:SHIPPING` → Pedido PV-000018 | 145 | Flete venta PV-000018 |
| A-000110 | 2026-09-17 | `ORDER:SHIPPING` → Pedido PV-000019 | 145 | Flete venta PV-000019 |
| A-000072 | 2026-08-10 | `MANUAL` (ajuste viejo) | crédito 610.909 | Ajuste IVA talonario ajeno |
| A-000087 | 2026-09-10 | `MANUAL` (ajuste viejo) | crédito 53.212 | Liquidación IVA Canale agosto |
| A-000115 | 2026-09-19 | `MANUAL_REV` (reversión, corrección de ventas) | 610.909 | Anulado — reemplazado por edición directa |
| A-000116 | 2026-09-19 | `MANUAL_REV` (reversión, corrección de ventas) | 53.212 | Anulado — reemplazado por edición directa |

Los pares `A-000072`↔`A-000115` y `A-000087`↔`A-000116` se cancelan exactamente entre sí (la reversión de la corrección de ventas funcionó perfecto, aporte neto = 0). **Los únicos dos orígenes con saldo real y vivo hoy son:**

- **Retenciones de IVA de clientes** (`IVA_RET`, 3 pedidos): **Gs. 610.909**
- **IVA de flete/envío** (`SHIPPING`, 6 pedidos): **Gs. 7.854**

`610.909 + 7.854 = 618.763` — exacto, sin resto sin explicar.

### 4. Clasificación

**No encontré ningún `Expense`/`Order` que debiera haber entrado en las correcciones anteriores y haya quedado afuera por descuido.** Lo que encontré es distinto: **dos mecanismos que ninguna de las dos correcciones tocó porque estaban fuera de su alcance declarado**, y que ahora, a la luz del mismo criterio de negocio (Kampro nunca facturó con timbrado/RUC propio), quedan en una posición contradictoria:

- **(a/b) Retenciones de IVA (`linesIvaRetention`, 610.909):** las 3 retenciones son de pedidos que **sí** fueron parte de la corrección de ventas (PV-000002, PV-000005, PV-000013 están entre las 19 ventas reclasificadas a EXENTA) — pero la corrección de ventas solo tocó el asiento `CLOSE` de cada pedido, no su asiento `IVA_RET` (son dos eventos contables separados para el mismo pedido). Si la venta ahora es EXENTA para Kampro, una "retención de IVA" del cliente ya no tiene el mismo sentido: probablemente esa retención corresponde a IVA de la factura emitida con el timbrado de Canale, no de Kampro — es decir, el cliente retuvo/pagó al SET algo relacionado con la obligación fiscal de Canale, no de Kampro. Cargarlo como crédito fiscal **propio** de Kampro parece el mismo error de fondo que ya corregimos, pero no me animo a asumir el tratamiento correcto (¿se anula sin más? ¿se convierte en un gasto/cuenta con Canale, ya que fue dinero que no llegó completo a Kampro?).
- **(b) IVA de flete/envío (`linesShippingPaid`, 7.854):** esta función nunca se tocó en ninguna de las dos correcciones. No sé si el proveedor de flete/delivery le factura a Kampro con el RUC propio de Kampro (en cuyo caso el crédito fiscal **sí sería legítimo** — tener RUC propio y no tener timbrado propio para facturar ventas son cosas distintas en Paraguay) o si también se factura de manera informal/bajo otro nombre. **Esto lo tenés que confirmar vos, no lo puedo inferir de los datos.**
- **(c) Saldo inicial u otro origen no tocado a propósito:** no encontré ninguno — los dos ajustes manuales viejos (`A-000072`, `A-000087`) ya están neutralizados por sus reversiones, y no hay ninguna otra línea histórica tocando esta cuenta.

## Diagnóstico

El saldo no está en cero porque **la corrección de ventas y la de gastos, tal como se diseñaron, nunca incluyeron `IVA_RET` (retenciones de cliente) ni `SHIPPING` (flete)** — ambas son rutas de código separadas (`linesIvaRetention` y `linesShippingPaid` en `kampro/src/domain/accounting-posting.ts`) que siguen posteando crédito fiscal de forma incondicional, sin ningún concepto de tratamiento EXENTA. No es un registro que "se escapó" de la corrección por error: es un tipo de operación que nunca estuvo en el alcance de ninguna de las dos.

## Recomendación (no aplicada — a la espera de tu decisión)

Antes de tocar nada necesito que confirmes dos cosas puntuales, porque cada una implica un tratamiento distinto:

1. **¿El flete/delivery se factura con el RUC propio de Kampro?** Si sí, los 7.854 Gs son legítimos y no hay que tocarlos. Si no (también es talonario prestado o informal sin factura), hay que reclasificar esas 6 líneas igual que se hizo con las ventas/gastos.
2. **¿Qué corresponde hacer con las 3 retenciones de IVA (610.909 Gs)?** Si esas facturas se emitieron con el timbrado de Canale, decime si querés (a) anularlas sin más, (b) convertir ese monto en un gasto/cuenta corriente con Canale (dinero que Kampro nunca terminó de cobrar en efectivo), u (c) otra cosa.

Con esas dos respuestas puedo diseñar (no aplicar) una Fase 2 igual que en los trabajos anteriores.
