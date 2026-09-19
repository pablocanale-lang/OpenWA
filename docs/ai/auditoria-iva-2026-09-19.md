# Auditoría de asientos contables — IVA / talonario prestado

> **Fecha:** 2026-09-19. **Alcance:** solo lectura, contra una copia de `kampro.sqlite` de producción
> traída por SSH a una carpeta temporal local (nunca escrita, fuera del repo). Ningún dato de
> producción fue modificado para generar este reporte.
>
> **Contexto de negocio confirmado por Pablo (2026-09-19):**
> 1. Las 19 ventas cerradas hasta la fecha son **todas** candidatas a reclasificar como EXENTA.
> 2. `G-000001` (jul, 214.670 Gs) y `G-000019` (ago, 259.390 Gs) son los **gastos reales** — el pago
>    efectivo de IVA hecho a la persona que presta el talonario. `A-000072` y `A-000087` son
>    **asientos de ajuste** (no un pago real) que hay que reemplazar por la edición directa de los
>    asientos de venta originales.
> 3. El talonario prestado **sigue vigente** hoy (no hay corte a timbrado propio todavía).

## 1. Verificación de integridad

- **114 asientos (`JournalEntry`) en total, 0 desbalanceados.** Se verificó `Σdébito = Σcrédito` línea
  por línea para cada uno de los 114.

## 2. Asientos por tipo

| sourceType | event | Cantidad | Suma débito = crédito (Gs) | Afectado por esta corrección |
|---|---|---:|---:|---|
| ORDER | CLOSE | 19 | 22.928.400 | **Sí** — reclasificar IVA_DEBITO → VENTAS |
| ORDER | COGS | 19 | 8.014.036 | No |
| ORDER | SHIPPING | 6 | 86.400 | No (IVA real de flete) |
| ORDER | IVA_RET | 3 | 610.909 | No (retención de cliente, no del talonario) |
| PAYMENT | PAY | 19 | 22.377.491 | No |
| PAYMENT | REFUND | 1 | 60.000 | No |
| PURCHASE_ORDER | PAY | 4 | 8.927.926 | No |
| PURCHASE_ORDER | CLOSE | 4 | 8.927.926 | No (sin costo local con IVA en estos 4) |
| EXPENSE | PAY | 29 | 9.064.307 | Parcial — 2 de los 29 son los gastos reales (ver §4) |
| EXPENSE | PAY_REV | 2 | 3.567.326 | No |
| MANUAL | MANUAL | 7 | 7.128.729 | **Sí, 2 de los 7** (`A-000072`, `A-000087`) |
| OPENING | CAPITAL | 1 | 432.674 | No |

## 3. Las 19 ventas — candidatas a reclasificar (ORDER/CLOSE → EXENTA)

Hoy `linesSaleRecognition` divide el bruto ÷11 y postea el neto a `VENTAS` y el resto a `IVA_DEBITO`
(nunca por línea). Reclasificar a EXENTA significa: **todo el bruto pasa a `VENTAS`, la línea de
`IVA_DEBITO` se da de baja.**

| Asiento | Fecha | Pedido | VENTAS (neto hoy) | IVA_DEBITO (a dar de baja) | Bruto (= nuevo VENTAS) |
|---|---|---|---:|---:|---:|
| A-000004 | 2026-03-30 | PV-000001 | 1.318.182 | 131.818 | 1.450.000 |
| A-000014 | 2026-05-04 | PV-000002 · 001-001-0000452 | 2.327.273 | 232.727 | 2.560.000 |
| A-000017 | 2026-07-01 | PV-000003 · 001-001-0000001 | 581.818 | 58.182 | 640.000 |
| A-000020 | 2026-07-06 | PV-000004 · 001-001-0000003 | 2.327.273 | 232.727 | 2.560.000 |
| A-000024 | 2026-07-07 | PV-000005 · 001-001-0000004 | 4.072.727 | 407.273 | 4.480.000 |
| A-000027 | 2026-07-31 | PV-000006 · 001-001-0000005 | 989.091 | 98.909 | 1.088.000 |
| A-000030 | 2026-08-04 | PV-000007 · 001-001-0000006 | 494.545 | 49.455 | 544.000 |
| A-000033 | 2026-08-04 | PV-000008 · 001-001-0000007 | 494.545 | 49.455 | 544.000 |
| A-000036 | 2026-08-06 | PV-000009 · 001-001-0000008 | 581.818 | 58.182 | 640.000 |
| A-000039 | 2026-08-14 | PV-000010 · 001-001-0000009 | 494.545 | 49.455 | 544.000 |
| A-000043 | 2026-08-14 | PV-000011 · 001-001-0000010 | 494.545 | 49.455 | 544.000 |
| A-000046 | 2026-08-14 | PV-000012 · 001-001-0000011 | 989.091 | 98.909 | 1.088.000 |
| A-000051 | 2026-08-14 | PV-000013 · 001-001-0000012 | 2.327.273 | 232.727 | 2.560.000 |
| A-000055 | 2026-08-21 | PV-000014 · 001-001-0000013 | 581.818 | 58.182 | 640.000 |
| A-000076 | 2026-09-12 | PV-000015 · 001-001-0000015 | 581.818 | 58.182 | 640.000 |
| A-000080 | 2026-09-12 | PV-000016 · 001-001-0000016 | 546.909 | 54.691 | 601.600 |
| A-000101 | 2026-09-14 | PV-000017 · 001-001-0000018 | 546.909 | 54.691 | 601.600 |
| A-000107 | 2026-09-17 | PV-000018 · 001-001-0000019 | 546.909 | 54.691 | 601.600 |
| A-000111 | 2026-09-17 | PV-000019 · 001-001-0000020 | 546.909 | 54.691 | 601.600 |
| **TOTAL** | | | **20.843.998** | **2.084.402** | **22.928.400** |

Ninguna de las 19 fue reversada ni cancelada (no hay `CLOSE_REV`) — las 19 están activas.

## 4. Los dos gastos reales de pago al prestador del talonario (correctos, no tocar)

| Gasto | Fecha | Monto | kind | ivaTreatment | Cuenta | Vendor |
|---|---|---:|---|---|---|---|
| G-000001 | 2026-08-10 (carga) | 214.670 | IMPUESTO | EXENTA | 6.1.08 Impuestos (GASTOS_IMPUESTOS) | "Canale — talonario ajeno" |
| G-000019 | 2026-09-10 (carga) | 259.390 | IMPUESTO | EXENTA | 6.1.08 Impuestos (GASTOS_IMPUESTOS) | "Pablo Canale" |

Estos dos ya están exactamente como pediste (decisión #3): gasto impositivo, EXENTA, sin
`IVA_CREDITO`. **No requieren ningún cambio.**

## 5. Los dos asientos de ajuste a reemplazar (MANUAL, no son el pago real)

| Asiento | Fecha | Línea | Cuenta | Débito | Crédito |
|---|---|---|---|---:|---:|
| A-000072 | 2026-08-10 | 1 | 2.1.03 IVA débito fiscal | 1.807.456 | 0 |
| A-000072 | | 2 | 1.1.05 IVA crédito fiscal | 0 | 610.909 |
| A-000072 | | 3 | 3.1.02 Resultados acumulados | 0 | 1.196.547 |
| A-000087 | 2026-09-10 | 1 | 2.1.03 IVA débito fiscal | 112.873 | 0 |
| A-000087 | | 2 | 1.1.05 IVA crédito fiscal | 0 | 53.212 |
| A-000087 | | 3 | 3.1.02 Resultados acumulados | 0 | 59.661 |

Son contra-asientos netos contra patrimonio (evitan tocar `VENTAS`, evitan pasar por el estado de
resultados del período) — exactamente lo que tu decisión #2 pide que no hagamos. Además **no
cerraron perfecto**: comparados contra el total real de las 19 ventas y de los gastos con IVA
legítimo, quedan sin reconciliar:

- **164.073 Gs** de `IVA_DEBITO` (2.084.402 generado por las 19 ventas − 1.920.329 dado de baja entre A-72 y A-87).
- **435 Gs** de `IVA_CREDITO` (664.556 generado por gastos legítimos − 664.121 dado de baja entre A-72 y A-87).

## 6. IVA_CREDITO legítimo — no tocar (24 líneas, 664.556 Gs)

Gastos operativos reales con proveedor real (Meta ads, Cursor IA, refrigerios), flete de venta, y
retenciones de IVA de clientes (`ORDER`/`IVA_RET`). Ninguno menciona a Canale ni al talonario
prestado. Detalle completo disponible en la consulta ya corrida; no se repite acá por espacio —
ninguno de estos 22 restantes (24 líneas − las que están en A-72/A-87, que no aparecen acá porque
esas dos ya se listaron en §5) es candidato.

## 7. Plan que se desprende de esto (para tu confirmación explícita antes de Fase 2)

1. **Reversar** `A-000072` y `A-000087` (son el mecanismo equivocado — contra-asiento en vez de
   edición directa) y dejar sin efecto su plug de 1.196.547 + 59.661 = **1.256.208 Gs** que hoy está
   metido en `Resultados acumulados` sin haber pasado por el resultado del ejercicio.
2. **Editar directamente** (decisión #2, mismo asiento, memo actualizado) los 19 `JournalEntry`
   `ORDER/CLOSE` de la tabla del §3: mover el total de `IVA_DEBITO` a `VENTAS`, dar de baja la línea
   de `IVA_DEBITO`.
3. **No tocar** `G-000001` ni `G-000019` — ya están bien.
4. Punto abierto para Fase 2: como el talonario **sigue vigente** hoy, ¿el default de
   `OrderLine.ivaTreatment` para pedidos **nuevos** (no solo los 19 históricos) debería ser EXENTA
   hasta que Kampro tenga timbrado propio? Lo marco [PENDIENTE] — no lo decido yo, te lo pregunto
   formalmente en el diseño de Fase 2.

**¿Confirmás este plan (reversar A-72/A-87 + editar los 19 asientos de venta, dejando G-1/G-19
intactos) para que pase a diseñar la Fase 2?**
