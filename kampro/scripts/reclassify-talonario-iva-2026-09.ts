/**
 * Corrección histórica: ventas facturadas con el talonario prestado (Canale) reclasificadas a
 * EXENTA, y los dos ajustes agregados previos (A-000072 "iva-talonario-ajuste", A-000087
 * "iva-liquidacion-canale-agosto-2026" — generado por settle-iva-agosto.ts) reversados, porque
 * usaban un contra-asiento neto contra Resultados acumulados en vez de editar el asiento de venta
 * original. Ver docs/ai/auditoria-iva-2026-09-19.md. Idempotente: cada paso se salta solo si ya
 * fue aplicado.
 *
 * Uso:
 *   npx tsx scripts/reclassify-talonario-iva-2026-09.ts
 *
 * G-000001 y G-000019 (pago real de IVA al prestador, jul/ago) NO se tocan — ya están bien.
 */
import 'dotenv/config';
import { JournalSource } from '@prisma/client';
import { prisma } from '../src/db.js';
import { saleCloseMemo } from '../src/services/accounting.service.js';
import { findActiveEntry, reverseEntry, rewriteActiveEntry } from '../src/services/journal.service.js';

const CORRECTION_DATE = '2026-09-19';
const CORRECTION_DATED_AT = new Date(`${CORRECTION_DATE}T12:00:00-03:00`);

// Únicamente estas 19 ventas fueron auditadas y confirmadas — no se toca ninguna otra CERRADO por
// las dudas de que haya alguna cerrada después de la auditoría que todavía no se revisó a mano.
const AUDITED_ORDER_NUMBER_LABELS = [
  'PV-000001', 'PV-000002', 'PV-000003', 'PV-000004', 'PV-000005', 'PV-000006', 'PV-000007',
  'PV-000008', 'PV-000009', 'PV-000010', 'PV-000011', 'PV-000012', 'PV-000013', 'PV-000014',
  'PV-000015', 'PV-000016', 'PV-000017', 'PV-000018', 'PV-000019',
];

const FLAWED_ADJUSTMENT_SOURCE_IDS = ['iva-talonario-ajuste', 'iva-liquidacion-canale-agosto-2026'];

async function reverseFlawedAdjustment(sourceId: string) {
  const entry = await prisma.journalEntry.findFirst({
    where: { sourceType: JournalSource.MANUAL, sourceId, event: 'MANUAL' },
    include: { reversedBy: true },
  });
  if (!entry) {
    console.log(`SKIP ${sourceId}: no existe`);
    return;
  }
  if (entry.reversedBy) {
    console.log(`SKIP ${sourceId}: ya reversado (${entry.reversedBy.numberLabel})`);
    return;
  }
  const memo = `Anulado ${CORRECTION_DATE}: era un ajuste neto contra Resultados acumulados, reemplazado por la edición directa de los asientos de venta reclasificados a EXENTA (talonario prestado)`;
  const rev = await prisma.$transaction((tx) => reverseEntry(tx, entry.id, CORRECTION_DATED_AT, memo));
  console.log(`OK reversado ${entry.numberLabel} (${sourceId}) -> ${rev.numberLabel}`);
}

async function reclassifyOrder(numberLabel: string) {
  const order = await prisma.order.findUnique({
    where: { numberLabel },
    select: { id: true, numberLabel: true, invoiceNumber: true },
  });
  if (!order) {
    console.log(`SKIP ${numberLabel}: pedido no encontrado`);
    return;
  }

  const items = await prisma.orderLine.findMany({ where: { orderId: order.id } });
  if (items.length > 0 && items.every((l) => l.ivaTreatment === 'EXENTA')) {
    console.log(`SKIP ${numberLabel}: OrderLine ya está en EXENTA`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const active = await findActiveEntry(tx, JournalSource.ORDER, order.id, 'CLOSE');
    if (!active) {
      console.log(`SKIP ${numberLabel}: no tiene asiento CLOSE activo`);
      return;
    }

    const [ventasAccount, ivaAccount] = await Promise.all([
      tx.account.findUniqueOrThrow({ where: { role: 'VENTAS' } }),
      tx.account.findUniqueOrThrow({ where: { role: 'IVA_DEBITO' } }),
    ]);

    const ventasLine = active.lines.find((l) => l.accountId === ventasAccount.id);
    const ivaLine = active.lines.find((l) => l.accountId === ivaAccount.id);
    if (!ventasLine) throw new Error(`${active.numberLabel}: sin línea VENTAS, no se puede reclasificar`);
    const ivaAmount = ivaLine?.credit ?? 0;
    if (ivaAmount === 0) {
      console.log(`SKIP ${numberLabel}: el asiento ${active.numberLabel} ya no tiene IVA_DEBITO`);
      return;
    }

    const before = { ventas: ventasLine.credit, ivaDebito: ivaAmount };

    // Movimiento quirúrgico: SOLO se toca VENTAS (+= ivaAmount) y se da de baja IVA_DEBITO. CXC,
    // ANTICIPO_CLIENTES y cualquier otra línea del asiento quedan exactamente como estaban.
    const newLines = active.lines
      .filter((l) => l.accountId !== ivaAccount.id)
      .map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.accountId === ventasAccount.id ? l.credit + ivaAmount : l.credit,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      }));

    const ref = order.numberLabel || order.id.slice(-6);
    const baseMemo = saleCloseMemo(ref, order.invoiceNumber);
    const newMemo = `${baseMemo} · Corregido ${CORRECTION_DATE}: reclasificado a EXENTA (talonario prestado, no genera IVA propio de Kampro)`;

    await tx.orderLine.updateMany({ where: { orderId: order.id }, data: { ivaTreatment: 'EXENTA' } });
    const updated = await rewriteActiveEntry(tx, {
      datedAt: active.datedAt,
      memo: newMemo,
      sourceType: JournalSource.ORDER,
      sourceId: order.id,
      event: 'CLOSE',
      lines: newLines,
    });

    console.log(
      `OK ${updated.numberLabel} ${numberLabel}: VENTAS ${before.ventas} -> ${before.ventas + ivaAmount}, IVA_DEBITO ${before.ivaDebito} -> 0`,
    );
  });
}

async function verifyLedgerBalance() {
  const sums = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
  const debit = sums._sum.debit ?? 0;
  const credit = sums._sum.credit ?? 0;
  console.log(`\nVerificación final: total débitos=${debit} total créditos=${credit}`);
  if (debit !== credit) {
    throw new Error(`LIBRO DESBALANCEADO tras la corrección: débito=${debit} crédito=${credit}`);
  }
  console.log('OK: el libro sigue balanceado.');
}

async function main() {
  console.log('=== 1. Reversando ajustes agregados previos (A-000072, A-000087) ===');
  for (const sourceId of FLAWED_ADJUSTMENT_SOURCE_IDS) {
    await reverseFlawedAdjustment(sourceId);
  }

  console.log('\n=== 2. Reclasificando las 19 ventas auditadas a EXENTA ===');
  for (const numberLabel of AUDITED_ORDER_NUMBER_LABELS) {
    await reclassifyOrder(numberLabel);
  }

  await verifyLedgerBalance();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
