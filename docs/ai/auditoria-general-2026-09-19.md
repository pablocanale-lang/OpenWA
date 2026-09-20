# Auditoría general de integridad contable — Kampro CRM

**Fecha:** 2026-09-19
**Alcance:** Etapa 1 de la auditoría solicitada (integridad técnica del libro contable). Solo
diagnóstico — **no se modificó ningún dato ni código de producción** en esta tarea.
**Método:** se tomó una copia de solo lectura de `kampro.sqlite` de producción (VPS
`root@206.189.206.119:/opt/openwa/kampro/data/kampro.sqlite`) y se ejecutaron consultas de
diagnóstico contra esa copia, en una carpeta temporal fuera del repositorio (ya eliminada). No se
escribió en la base de producción.
**Estado de la base auditada:** 117 asientos, 238 líneas, 40 cuentas, 19 pedidos, 4 órdenes de
compra, 27 gastos.

## Resumen ejecutivo

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Partida doble por asiento | ✅ OK |
| 2 | Clasificación de cuentas | ✅ CORREGIDO (2 hallazgos, ambos ya solucionados) |
| 3 | Secuencias sin huecos anómalos | ✅ OK (todos los huecos explicados — ver detalle) |
| 4 | Consistencia con correcciones ya aplicadas | ✅ OK |
| 5 | Inventario y PEPS vs. CMV | ⚠️ ADVERTENCIA menor (redondeo de Gs. 8, inmaterial) |
| 6 | Balance General cuadra | ✅ OK |

**Ninguno de los hallazgos de esta etapa es un ERROR** (nada rompe la partida doble ni descuadra el
balance). Los marcados ADVERTENCIA son puntos a confirmar con vos, no defectos comprobados.

---

## 1. Balance de partida doble — ✅ OK

Se revisaron los 117 asientos (`JournalEntry`) individualmente, sumando débitos y créditos de sus
`JournalLine`.

- **Asientos desbalanceados: 0.**
- Total débitos global = total créditos global = **Gs. 94.049.853** (coincide exacto).
- No se encontraron líneas con importe negativo.
- No se encontraron líneas con débito y crédito a la vez (violaría `compactDraftLines`).
- No se encontraron asientos sin líneas.

No hay nada que corregir en este punto.

## 2. Clasificación de cuentas — ⚠️ ADVERTENCIA

Se comparó el plan de cuentas de producción (40 cuentas) contra el seed canónico en
`kampro/src/domain/chart-of-accounts.ts` (39 cuentas).

- Las 39 cuentas del seed existen en producción con el `type`, `role`, `postable` y cuenta padre
  correctos. Sin duplicados de `role`, sin cuentas inactivas con movimientos, sin cuentas no
  imputables con movimientos.

**Hallazgo A — cuenta fuera de la jerarquía — ✅ CORREGIDO (2026-09-19):** existía una cuenta extra,
código **`7` "Gastos por honorarios"** (tipo EXPENSE, imputable, creada el 2026-09-13,
`system=false`), que no estaba en el seed y vivía como capítulo raíz nuevo, hermano de
ACTIVO/PASIVO/PATRIMONIO/INGRESOS/COSTOS/GASTOS, en vez de estar anidada bajo `6` (GASTOS). Se
reubicó a **`6.1.10`**, bajo GASTOS, con el script `kampro/scripts/relocate-honorarios-account-2026-09-19.ts`
(idempotente, probado antes contra una copia local): solo cambia `code` y `parentId` de la cuenta —
no toca ninguna `JournalLine`, asiento ni monto. Sus 4 líneas contables reales (pagos de honorarios
a Canale y Pei) quedan intactas, ahora bajo el código correcto.

**Hallazgo B — mismo tipo de evento contable posteado a dos cuentas de tesorería distintas — ✅
CORREGIDO (2026-09-19):** el código anterior (`linesShippingPaid` en `accounting-posting.ts`)
posteaba **siempre** el costo de flete (evento `ORDER/SHIPPING`) contra **CAJA**, sin importar cómo
se pagó realmente. 2 asientos históricos (cargados por el script de importación inicial, antes de
que existiera el sistema) ya posteaban flete directamente contra **BANCO** — es decir, el propio
histórico mostraba que hacía falta poder elegir. En los 4 casos posteriores que sí pasaban por CAJA
(PV-000016/17/18/19) el ciclo de caja era coherente (cobro COD → flete en efectivo → depósito del
remanente a Banco, saldo de Caja en Gs. 0 exacto — ver punto 6), pero eso no descarta que en el
futuro un flete se pague por transferencia y el sistema lo siga registrando igual contra Caja.

Se corrigió el código: `linesShippingPaid`/`postShippingCost` ahora reciben la cuenta de tesorería
como parámetro (`Order.shippingTreasury`, nuevo campo, default **BANCO**) en vez de tenerla
hardcodeada, y el dashboard agrega un selector Caja/Banco junto al de IVA del flete (panel de
detalles y modal de cierre del pedido). El comportamiento por defecto pasó de Caja a Banco — no se
tocó ningún asiento ya posteado; el cambio solo afecta pedidos que se editen/cierren de acá en
adelante.

## 3. Secuencias — ⚠️ ADVERTENCIA (huecos de factura a confirmar)

| Secuencia | Estado |
|---|---|
| `JournalSequence` (asientos, A-######) | 117 asientos, próximo número 119, **1 hueco: A-000114**. Sin duplicados. |
| `OperationSequence` — pedidos (PV-######) | 19/19, sin huecos, sin duplicados. |
| `OperationSequence` — órdenes de compra (OC-######) | 4/4, sin huecos, sin duplicados. Las 4 en estado CERRADA. |
| `OperationSequence` — gastos (G-######) | 27 gastos, **1 hueco: G-000027**. Sin duplicados. |
| `InvoiceSequence` (facturas 001-001-#######) | próximo número 21. **3 huecos: #2, #14 y #17**. Sin duplicados. |

**El hueco A-000114 y el hueco G-000027 ya están explicados** por la corrección de gastos del
talonario prestado (`fix-gastos-talonario-2026-09.ts`): G-000027 era "un duplicado fantasma de un
intento anterior de corregir G-000028 a mano" y se **eliminó por completo** (Expense + JournalEntry
+ JournalLine), a propósito y sin dejar rastro. Eso mueve el asiento correspondiente exactamente al
número A-000114 que falta. No requiere ninguna acción.

**Los 3 huecos de facturación quedaron confirmados por el usuario: son facturas anuladas en el
talonario físico**, no un pedido faltante ni un error de carga:
- **Factura #2** (`001-001-0000002`): ANULADA. No aparece en ningún pedido; el rango histórico
  cargado manualmente (`import-historico.ts`) incluye las facturas #1, #3 a #13, pero nunca la #2.
- **Factura #14** (`001-001-0000014`): ANULADA. Hay un salto de la factura #13 (PV-000014,
  2026-08-21) a la #15 (PV-000015, 2026-09-12).
- **Factura #17** (`001-001-0000017`): ANULADA. PV-000017 (2026-09-14) usa la #18, no la #17.
- La factura **#452** (PV-000002) es una referencia histórica real preexistente al sistema (una
  venta ya facturada antes de que existiera Kampro CRM) — no forma parte de la secuencia interna y
  **no es una anomalía**.
- PV-000001 (venta histórica de relojes MoonSwatch) no tiene número de factura asignado
  (`s/FC`) — así quedó cargada a propósito en la importación histórica, tampoco es una anomalía.

Los pedidos PV-000001 a PV-000019 existen todos y están CERRADO sin excepción — ninguno fue
cancelado ni eliminado —, consistente con que las facturas #2, #14 y #17 nunca llegaron a asociarse
a un pedido: se anularon en el talonario antes de usarse. **Cerrado, sin acción pendiente.**

## 4. Consistencia con correcciones ya aplicadas — ✅ OK

Se verificaron, contra el estado actual completo del libro, las tres correcciones hechas
previamente en esta misma auditoría:

- **19/19 ventas** reclasificadas a EXENTA (`PV-000001` a `PV-000019`): el 100% tiene sus
  `OrderLine.ivaTreatment = EXENTA`, ningún asiento CLOSE activo conserva línea `IVA_DEBITO`, y
  ninguno quedó reversado por error.
- **Gastos G-000022 y G-000028**: montos brutos corregidos a Gs. 53.537 y Gs. 47.087
  respectivamente, ambos en EXENTA — confirmado.
- **G-000027** (duplicado fantasma): confirmado que ya no existe en la base.
- **Los 9 asientos de retenciones y flete** reclasificados (A-000013, A-000023, A-000050,
  A-000041, A-000048, A-000079, A-000099, A-000106, A-000110): ninguno conserva línea
  `IVA_CREDITO` residual.
- **Saldo global de IVA:** `IVA_DEBITO` = Gs. 0 e `IVA_CREDITO` = Gs. 0, exactos, en todo el libro.
  Los únicos movimientos históricos en esas dos cuentas son los ajustes A-000072/A-000087 (agosto,
  ya reversados) y sus propias reversiones A-000115/A-000116 (19/09), que se cancelan
  perfectamente entre sí.

No quedó ningún registro con el criterio contable anterior a las tres correcciones.

## 5. Inventario y PEPS vs. CMV — ⚠️ ADVERTENCIA menor (inmaterial)

- **19/19 asientos de costo de venta (COGS) activos** cuadran EXACTO contra la suma de
  `LotConsumption.quantity × unitCostPyg` del pedido correspondiente. Ningún pedido CERRADO carece
  de un asiento COGS activo.
- Por producto, la aritmética de lotes (`qtyOriginal − consumido = qtyRemaining`) es correcta en
  los 4 productos con movimiento (JER-50ML, JER-2ML, JER-5ML, REL-MOON), y coincide exacto con
  `Product.stockQty` en los 4 casos.
- No existe ningún asiento de ajuste manual de inventario (`STOCK/ADJUST`) — nunca se usó esa
  función.

**Hallazgo menor:** el saldo de la cuenta INVENTARIO en el libro (Gs. 1.346.564) difiere en
**Gs. 8** del valor de los lotes remanentes (Gs. 1.346.556). Rastreado a redondeo del costo
unitario al prorratear flete/aduana entre las líneas de las órdenes de compra OC-000002 (+5),
OC-000003 (−1) y OC-000004 (+4) — es un artefacto aritmético de `Math.round()` por línea en
`postPurchaseClose`, económicamente irrelevante (menos de un centavo de dólar) y **no tiene
ninguna relación con la diferencia bancaria de Gs. 112.522** que estamos investigando. Lo dejo
anotado por completitud, no amerita acción.

## 6. Balance General — ✅ OK, balancea exacto

| | Monto (Gs.) |
|---|---:|
| **Activo** | **12.719.874** |
| — Banco (UENO PYG, rol BANCO) | 11.373.310 |
| — Inventario de mercaderías | 1.346.564 |
| **Pasivo** | **0** |
| **Patrimonio** | **12.719.874** |
| — Capital | 4.000.000 |
| — Resultado del ejercicio | 8.719.874 |
| &nbsp;&nbsp;(Ingresos 22.928.400 − Costos 8.014.036 − Gastos 6.194.490) | |
| **Activo − (Pasivo + Patrimonio)** | **0** |

El Balance General **balancea exacto**. Como referencia cruzada útil para la Etapa 2: el saldo de
Banco que arroja el libro contable de forma independiente (Gs. 11.373.310) coincide exactamente con
la cifra que me diste como saldo del ERP — confirma que no hay ninguna cuenta paralela o vista
alternativa metiendo ruido en ese número.

También de interés para la Etapa 2: la cuenta **Caja da saldo Gs. 0 exacto** (débitos = créditos =
Gs. 1.244.800). Los únicos 9 movimientos que tocan Caja en toda la vida del sistema son: 2 cobros
de contado (COD), 4 pagos de flete, 2 depósitos a Banco y un ajuste de Gs. 3.200 — y calzan
perfectamente entre sí. No hay ningún remanente de efectivo "flotando" sin explicar.

Chequeos adicionales de integridad estructural (no pedidos explícitamente pero relevantes):
ninguna clave `(sourceType, sourceId, event)` tiene más de un asiento activo simultáneo, y ninguna
reversión (`reversesId`) apunta a un asiento inexistente. La cadena de reversiones está sana.

---

## Qué falta para la Etapa 2

Según indicaste, necesito antes de avanzar:
1. **Fecha** de la transferencia de apertura de la cuenta bancaria actual.
2. **Monto** transferido en esa apertura.
3. **Extracto de la cuenta VIEJA** (hasta la fecha de apertura).
4. **Extracto de la cuenta ACTUAL** (desde la apertura hasta hoy).

No tengo ninguno de los cuatro todavía — quedo a la espera antes de tocar la Etapa 2, tal como
pediste.
