/**
 * Corrección histórica de gastos/compras facturados bajo el talonario prestado (Canale). Ver
 * docs/ai/auditoria-gastos-talonario-2026-09-19.md.
 *
 * A diferencia de reclassify-talonario-iva-2026-09.ts (corrección del lado ventas), acá NO se deja
 * memo de "Corregido el <fecha>" ni ningún rastro de reversión: se edita el mismo asiento (mismo
 * número, mismo memo, misma fecha) para que quede como si se hubiera cargado bien desde el
 * principio, por pedido explícito del usuario (2026-09-19).
 *
 * - G-000027 se ELIMINA por completo (Expense + JournalEntry + JournalLine) — nunca correspondió
 *   a una salida real de banco, es un duplicado fantasma de un intento anterior de corregir
 *   G-000028 a mano.
 * - Tipo A (RECLASSIFY_ONLY): el amountGrossPyg ya era el bruto real; solo se reclasifica a EXENTA
 *   y se elimina la línea IVA_CREDITO, sumando su monto a la línea de Gasto. Tesorería sin cambio.
 * - Normalización (NORMALIZE_ONLY): ya se comportan como EXENTA hoy (ivaIncluded=false); solo se
 *   fija el campo ivaTreatment explícito. Cero impacto en el asiento.
 * - Tipo B (AMOUNT_FIXES): ya están en EXENTA, pero el monto cargado era el neto/subtotal, no el
 *   bruto real. Sube tanto la línea de Gasto como la de Tesorería por el mismo delta.
 *
 * Uso: npx tsx scripts/fix-gastos-talonario-2026-09.ts
 */
import 'dotenv/config';
import { JournalSource } from '@prisma/client';
import { prisma } from '../src/db.js';
import { findActiveEntry, rewriteActiveEntry } from '../src/services/journal.service.js';

const DUPLICATE_TO_DELETE = 'G-000027';

const RECLASSIFY_ONLY = [
  'G-000007', 'G-000008', 'G-000009', 'G-000010', 'G-000011', 'G-000012', 'G-000013',
  'G-000014', 'G-000015', 'G-000017', 'G-000006', 'G-000016', 'G-000018',
];

const NORMALIZE_ONLY = ['G-000002', 'G-000003', 'G-000004', 'G-000005'];

const AMOUNT_FIXES: Record<string, number> = {
  'G-000022': 53537,
  'G-000028': 47087,
};

async function deleteDuplicate(numberLabel: string) {
  const expense = await prisma.expense.findUnique({ where: { numberLabel } });
  if (!expense) {
    console.log(`SKIP ${numberLabel}: no existe (ya eliminado)`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSource.EXPENSE, sourceId: expense.id, event: 'PAY' },
    });
    if (entry) {
      await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
    }
    await tx.expense.delete({ where: { id: expense.id } });
  });
  console.log(`OK eliminado ${numberLabel} (Expense + asiento, sin dejar rastro)`);
}

async function reclassifyToExenta(numberLabel: string) {
  const expense = await prisma.expense.findUnique({ where: { numberLabel } });
  if (!expense) {
    console.log(`SKIP ${numberLabel}: no encontrado`);
    return;
  }
  if (expense.ivaTreatment === 'EXENTA') {
    console.log(`SKIP ${numberLabel}: ya EXENTA`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const entry = await findActiveEntry(tx, JournalSource.EXPENSE, expense.id, 'PAY');
    const ivaAccount = await tx.account.findUniqueOrThrow({ where: { role: 'IVA_CREDITO' } });

    await tx.expense.update({ where: { id: expense.id }, data: { ivaTreatment: 'EXENTA', ivaIncluded: false } });

    if (!entry) {
      console.log(`OK ${numberLabel}: Expense actualizado (sin asiento activo que ajustar)`);
      return;
    }

    const ivaLine = entry.lines.find((l) => l.accountId === ivaAccount.id);
    const ivaAmount = ivaLine?.debit ?? 0;
    if (ivaAmount === 0) {
      console.log(`OK ${numberLabel}: Expense actualizado (el asiento ${entry.numberLabel} ya no tenía IVA_CREDITO)`);
      return;
    }
    const expenseLine = entry.lines.find((l) => l.accountId !== ivaAccount.id && l.debit > 0);
    if (!expenseLine) throw new Error(`${entry.numberLabel}: no se encontró la línea de gasto`);

    const newLines = entry.lines
      .filter((l) => l.accountId !== ivaAccount.id)
      .map((l) => ({
        accountId: l.accountId,
        debit: l.accountId === expenseLine.accountId ? l.debit + ivaAmount : l.debit,
        credit: l.credit,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      }));

    await rewriteActiveEntry(tx, {
      datedAt: entry.datedAt,
      memo: entry.memo, // sin cambios: mismo memo, sin nota de corrección
      sourceType: JournalSource.EXPENSE,
      sourceId: expense.id,
      event: 'PAY',
      lines: newLines,
    });
    console.log(
      `OK ${numberLabel} ${entry.numberLabel}: Gasto ${expenseLine.debit} -> ${expenseLine.debit + ivaAmount}, IVA_CREDITO ${ivaAmount} -> 0`,
    );
  });
}

async function normalizeTreatment(numberLabel: string) {
  const expense = await prisma.expense.findUnique({ where: { numberLabel } });
  if (!expense) {
    console.log(`SKIP ${numberLabel}: no encontrado`);
    return;
  }
  if (expense.ivaTreatment === 'EXENTA') {
    console.log(`SKIP ${numberLabel}: ya EXENTA`);
    return;
  }
  await prisma.expense.update({ where: { id: expense.id }, data: { ivaTreatment: 'EXENTA', ivaIncluded: false } });
  console.log(`OK ${numberLabel}: ivaTreatment normalizado a EXENTA (sin cambio de asiento, ya se comportaba así)`);
}

async function fixAmount(numberLabel: string, newGross: number) {
  const expense = await prisma.expense.findUnique({ where: { numberLabel } });
  if (!expense) {
    console.log(`SKIP ${numberLabel}: no encontrado`);
    return;
  }
  if (expense.amountGrossPyg === newGross) {
    console.log(`SKIP ${numberLabel}: ya está en ${newGross}`);
    return;
  }
  if (expense.ivaTreatment !== 'EXENTA') {
    throw new Error(`${numberLabel}: se esperaba EXENTA antes de ajustar el monto, encontrado ${expense.ivaTreatment}`);
  }

  await prisma.$transaction(async (tx) => {
    const entry = await findActiveEntry(tx, JournalSource.EXPENSE, expense.id, 'PAY');
    const oldGross = expense.amountGrossPyg;
    const delta = newGross - oldGross;

    await tx.expense.update({ where: { id: expense.id }, data: { amountGrossPyg: newGross } });

    if (!entry) {
      console.log(`OK ${numberLabel}: Expense actualizado (sin asiento activo)`);
      return;
    }

    const treasuryAccount = await tx.account.findFirst({
      where: { role: { in: ['BANCO', 'CAJA'] }, id: { in: entry.lines.map((l) => l.accountId) } },
    });
    if (!treasuryAccount) throw new Error(`${entry.numberLabel}: no se encontró la línea de tesorería`);
    const expenseLine = entry.lines.find((l) => l.accountId !== treasuryAccount.id);
    if (!expenseLine) throw new Error(`${entry.numberLabel}: no se encontró la línea de gasto`);

    const newLines = entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.accountId === expenseLine.accountId ? l.debit + delta : l.debit,
      credit: l.accountId === treasuryAccount.id ? l.credit + delta : l.credit,
      memo: l.memo ?? undefined,
      productId: l.productId ?? undefined,
      quantity: l.quantity ?? undefined,
    }));

    await rewriteActiveEntry(tx, {
      datedAt: entry.datedAt,
      memo: entry.memo,
      sourceType: JournalSource.EXPENSE,
      sourceId: expense.id,
      event: 'PAY',
      lines: newLines,
    });
    console.log(`OK ${numberLabel} ${entry.numberLabel}: monto ${oldGross} -> ${newGross}`);
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
  console.log('=== 1. Eliminando duplicado fantasma ===');
  await deleteDuplicate(DUPLICATE_TO_DELETE);

  console.log('\n=== 2. Reclasificando a EXENTA (con impacto en el asiento) ===');
  for (const n of RECLASSIFY_ONLY) await reclassifyToExenta(n);

  console.log('\n=== 3. Normalizando ivaTreatment (sin impacto en el asiento) ===');
  for (const n of NORMALIZE_ONLY) await normalizeTreatment(n);

  console.log('\n=== 4. Corrigiendo montos al bruto real confirmado ===');
  for (const [n, amount] of Object.entries(AMOUNT_FIXES)) await fixAmount(n, amount);

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
