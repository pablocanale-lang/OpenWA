/**
 * Corrección histórica del saldo de IVA Crédito Fiscal. Ver
 * docs/ai/auditoria-iva-credito-2026-09-19.md.
 *
 * Mismo criterio "sin rastro" que fix-gastos-talonario-2026-09.ts: se edita el mismo asiento
 * (mismo número, mismo memo, misma fecha), no se deja nota de corrección ni reversión.
 *
 * - Retenciones de IVA (3 asientos ORDER/IVA_RET): las facturas se emitieron con el timbrado de
 *   Canale, así que la retención del cliente fue a nombre de Canale, no de Kampro — Kampro nunca
 *   puede usar ese "crédito fiscal". Es dinero real que Kampro no cobró, del mismo tipo que ya
 *   reconocimos como GASTOS_IMPUESTOS en los pagos directos a Canale (G-000001/G-000019). La línea
 *   IVA_CREDITO se reclasifica a GASTOS_IMPUESTOS, misma cuenta 6.1.08. La línea ANTICIPO_CLIENTES
 *   no se toca.
 * - Flete/envío (6 asientos ORDER/SHIPPING): confirmado que la transportadora no factura con RUC
 *   propio de Kampro. La línea IVA_CREDITO se reclasifica a FLETE_VENTAS (se suma a la línea de
 *   flete que ya existe). La línea de Tesorería (Caja/Banco) no se toca.
 *
 * Uso: npx tsx scripts/fix-iva-credito-retenciones-flete-2026-09.ts
 */
import 'dotenv/config';
import { prisma } from '../src/db.js';
import { rewriteActiveEntry } from '../src/services/journal.service.js';

const RETENTIONS = ['A-000013', 'A-000023', 'A-000050']; // IVA_CREDITO -> GASTOS_IMPUESTOS
const SHIPPING = ['A-000041', 'A-000048', 'A-000079', 'A-000099', 'A-000106', 'A-000110']; // IVA_CREDITO -> FLETE_VENTAS

async function reclassifyLine(entryLabel: string, fromRole: string, toRole: string) {
  const entry = await prisma.journalEntry.findUnique({
    where: { numberLabel: entryLabel },
    include: { lines: { include: { account: true } } },
  });
  if (!entry) {
    console.log(`SKIP ${entryLabel}: no encontrado`);
    return;
  }
  const fromLine = entry.lines.find((l) => l.account.role === fromRole);
  if (!fromLine) {
    console.log(`SKIP ${entryLabel}: ya no tiene línea ${fromRole}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const toAccount = await tx.account.findUniqueOrThrow({ where: { role: toRole as never } });
    const newLines = entry.lines
      .filter((l) => l.id !== fromLine.id)
      .map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo ?? undefined,
        productId: l.productId ?? undefined,
        quantity: l.quantity ?? undefined,
      }));

    const existingToLine = newLines.find((l) => l.accountId === toAccount.id);
    if (existingToLine) {
      existingToLine.debit += fromLine.debit;
      existingToLine.credit += fromLine.credit;
    } else {
      newLines.push({
        accountId: toAccount.id,
        debit: fromLine.debit,
        credit: fromLine.credit,
        memo: fromLine.memo ?? undefined,
        productId: undefined,
        quantity: undefined,
      });
    }

    await rewriteActiveEntry(tx, {
      datedAt: entry.datedAt,
      memo: entry.memo, // sin cambios: mismo memo, sin nota de corrección
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      event: entry.event,
      lines: newLines,
    });
  });
  console.log(`OK ${entryLabel}: ${fromRole} (${fromLine.debit || fromLine.credit}) -> ${toRole}`);
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

async function verifyIvaCreditoZero() {
  const account = await prisma.account.findUnique({ where: { role: 'IVA_CREDITO' } });
  if (!account) return;
  const sums = await prisma.journalLine.aggregate({
    where: { accountId: account.id },
    _sum: { debit: true, credit: true },
  });
  const debit = sums._sum.debit ?? 0;
  const credit = sums._sum.credit ?? 0;
  console.log(`Saldo IVA_CREDITO tras la corrección: debit=${debit} credit=${credit} saldo=${debit - credit}`);
}

async function main() {
  console.log('=== 1. Retenciones de IVA (Canale) -> GASTOS_IMPUESTOS ===');
  for (const label of RETENTIONS) await reclassifyLine(label, 'IVA_CREDITO', 'GASTOS_IMPUESTOS');

  console.log('\n=== 2. IVA de flete (sin RUC propio) -> FLETE_VENTAS ===');
  for (const label of SHIPPING) await reclassifyLine(label, 'IVA_CREDITO', 'FLETE_VENTAS');

  await verifyIvaCreditoZero();
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
