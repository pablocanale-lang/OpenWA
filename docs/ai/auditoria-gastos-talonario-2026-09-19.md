# Auditoría de gastos — talonario prestado (lado compras/gastos)

> **Fecha:** 2026-09-19. Solo lectura, contra una copia fresca de `kampro.sqlite` de producción
> traída por SSH a una carpeta temporal local. Ningún dato de producción fue modificado.
>
> **Contexto:** las facturas de compras/gastos de Kampro se emitieron a nombre de la persona que
> presta el talonario, pero el 100% del dinero salió del banco de Kampro. Para Kampro estas
> operaciones son EXENTAS (no se toma crédito fiscal de IVA), pero el monto a registrar como gasto
> tiene que ser el bruto real que salió del banco, no el neto sin IVA.

## Fase 0 — Cómo funciona hoy

- `Expense.amountGrossPyg`: único campo de monto. No existe un campo separado para "monto neto"
  vs "monto bancario real" — si está mal cargado, no se puede recuperar el valor correcto desde el
  propio registro.
- `Expense.ivaTreatment` (`IVA_10 | IVA_5 | EXENTA`, nullable): mismo campo que ya usamos en la
  corrección de ventas. No hace falta tocar el schema.
- Asiento contable (`postExpenseJournal` → `linesExpense`, confirmado contra datos reales):
  - `IVA_10` / `IVA_5`: **3 líneas** — Gasto (neto) + `IVA_CREDITO` (la porción de IVA) + Tesorería
    (crédito por el `amountGrossPyg` completo).
  - `EXENTA`: **2 líneas** — Gasto = `amountGrossPyg` completo + Tesorería (mismo monto). Sin
    ninguna línea de `IVA_CREDITO`.
- No existe ningún campo que identifique "talonario prestado" en `Expense`. El único criterio
  disponible es `vendor` / `description` a simple vista.

**Hallazgo:** el error no es uniforme. Algunos registros de Meta Ads ya tienen `ivaTreatment=EXENTA`
(`G-000022`, `G-000027`, `G-000028`) pero el monto sigue pareciendo el neto; otros siguen en
`IVA_10` (`G-000007`–`G-000017`) con el mismo problema de fondo (monto neto + crédito fiscal
ficticio). Por eso la columna de monto real queda vacía en TODOS los candidatos, no solo los que
todavía dicen IVA_10.

## Fase 1 — Candidatos claros (proveedor Meta / Facebook Ads)

| Fecha | Registro | Proveedor | ivaTreatment actual | Monto cargado hoy (Gs) | Monto real pagado (Gs) | Nota |
|---|---|---|---|---:|---|---|
| 2026-08-04 | G-000007 | Meta | IVA_10 | 13.365 | | |
| 2026-08-05 | G-000008 | Meta | IVA_10 | 13.365 | | |
| 2026-08-06 | G-000009 | Meta | IVA_10 | 13.178 | | |
| 2026-08-10 | G-000010 | Meta | IVA_10 | 13.178 | | |
| 2026-08-10 | G-000011 | Meta | IVA_10 | 24.578 | | |
| 2026-08-13 | G-000012 | Meta | IVA_10 | 29.636 | | |
| 2026-08-17 | G-000013 | Meta | IVA_10 | 42.439 | | |
| 2026-08-24 | G-000014 | Meta | IVA_10 | 53.537 | | |
| 2026-08-27 | G-000015 | Meta | IVA_10 | 39.408 | | |
| 2026-09-08 | G-000017 | Meta ads | IVA_10 | 53.537 | | |
| 2026-09-12 | G-000022 | Meta | EXENTA | 48.670 | | tratamiento ya EXENTA, ¿monto también ya correcto? |
| 2026-09-12 | G-000027 | Publicidad | EXENTA | 47.087 | | tratamiento ya EXENTA, ¿monto también ya correcto? |
| 2026-09-17 | G-000028 | Facebook - Meta ads | EXENTA | 42.806 | | ejemplo dado por el usuario — real confirmado 47.087 |

## Fase 1 — Dudosos (confirmar si corresponden al talonario prestado)

| Fecha | Registro | Proveedor/Descripción | ivaTreatment actual | Monto cargado hoy (Gs) | ¿Talonario prestado? | Monto real pagado (Gs) |
|---|---|---|---|---:|---|---|
| 2026-07-07 | G-000003 | Gasto operativo por delivery (sin proveedor) | EXENTA (ivaIncluded=false) | 35.000 | | |
| 2026-08-07 | G-000002 | Afiliación comercial con el Ing. Carrillo | EXENTA (ivaIncluded=false) | 222.000 | | |
| 2026-08-14 | G-000004 | Gasto operativo por estacionamiento (sin proveedor) | EXENTA (ivaIncluded=false) | 10.000 | | |
| 2026-08-24 | G-000005 | Gasto operativo por refrigerio (sin proveedor) | EXENTA (ivaIncluded=false) | 28.000 | | |
| 2026-08-25 | G-000006 | Herramienta - Cursor IA (vendor: Cursor) | IVA_10 (default) | 135.500 | | |
| 2026-09-04 | G-000016 | "Pei & Canale EAS" (vendor: Sellos Express Py) | IVA_10 (default) | 60.000 | | |
| 2026-09-12 | G-000018 | Refrigerios (vendor: biggie) | IVA_10 (explícito) | 12.000 | | |

**Regla:** no se calculó ningún monto real — todas las celdas de "Monto real pagado" quedan vacías
a propósito para que el usuario las complete caso por caso.
