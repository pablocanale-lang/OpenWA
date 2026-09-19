/**
 * Producción: pago IVA Canale agosto (Gs 259.390) y baja de IVA débito/crédito
 * que correspondieron al prestador. Idempotente.
 */
import 'dotenv/config';
import { ExpenseKind, JournalSource, TreasuryAccount } from '@prisma/client';
import { prisma } from '../src/db.js';
import { HttpError } from '../src/http-error.js';
import { createExpense, updateExpense } from '../src/services/expenses.service.js';
import { postEntry } from '../src/services/journal.service.js';

const TREASURY = TreasuryAccount.BANCO;
const PAY_DATE = '2026-09-10';
const IVA_ZERO_SOURCE = 'iva-liquidacion-canale-agosto-2026';
const JULY_AMOUNT = 214_670;
const AUGUST_AMOUNT = 259_390;

function at(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

function signedIva(role: string, debit: number, credit: number) {
  if (role === 'IVA_DEBITO') return credit - debit;
  return debit - credit;
}

async function relabelJulyPayment() {
  const row = await prisma.expense.findFirst({
    where: { amountGrossPyg: JULY_AMOUNT, description: { contains: 'Pago de IVA Canale' } },
    orderBy: { number: 'asc' },
  });
  if (!row) {
    console.log('SKIP relabel julio (no está G-000001)');
    return;
  }
  if (row.description.includes('julio')) {
    console.log(`SKIP relabel julio (ya dice julio: ${row.numberLabel})`);
    return;
  }
  const updated = await updateExpense(row.id, {
    description: 'Pago de IVA Canale — julio',
    reference: 'IVA prestador · liquidación julio',
  });
  console.log(`OK ${updated.numberLabel} relabel → ${updated.description}`);
}

async function payAugust() {
  try {
    const expense = await createExpense({
      kind: ExpenseKind.GENERAL,
      datedAt: at(PAY_DATE),
      description: 'Pago de IVA Canale — agosto',
      amountGrossPyg: AUGUST_AMOUNT,
      ivaIncluded: false,
      treasury: TREASURY,
      vendor: 'Pablo Canale',
      reference: 'Liquidación IVA agosto',
    });
    console.log(`OK ${expense.numberLabel} pago agosto ${AUGUST_AMOUNT}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HttpError && err.statusCode === 400 && message.includes('ya está cargado')) {
      console.log(`SKIP pago agosto (ya está cargado)`);
      return;
    }
    throw err;
  }
}

async function zeroIvaBalances() {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: JournalSource.MANUAL, sourceId: IVA_ZERO_SOURCE, event: 'MANUAL' },
  });
  if (existing) {
    console.log(`SKIP baja IVA (ya existe ${existing.numberLabel})`);
    return;
  }

  const lines = await prisma.journalLine.findMany({
    where: { account: { role: { in: ['IVA_DEBITO', 'IVA_CREDITO'] } } },
    include: { account: { select: { role: true } } },
  });

  let debito = 0;
  let credito = 0;
  for (const line of lines) {
    const role = line.account.role ?? '';
    const net = signedIva(role, line.debit, line.credit);
    if (role === 'IVA_DEBITO') debito += net;
    if (role === 'IVA_CREDITO') credito += net;
  }

  if (debito < 1 && credito < 1) {
    console.log('SKIP baja IVA (saldos ya en cero)');
    return;
  }
  if (debito < 0 || credito < 0) {
    throw new Error(`Saldos IVA invertidos: débito=${debito} crédito=${credito}`);
  }

  const plug = debito - credito;
  const draft = [
    debito > 0 ? { role: 'IVA_DEBITO' as const, debit: debito, credit: 0, memo: 'Baja IVA débito facturas Canale' } : null,
    credito > 0 ? { role: 'IVA_CREDITO' as const, debit: 0, credit: credito, memo: 'Baja IVA crédito usado en SET Canale' } : null,
    plug > 0
      ? { role: 'RESULTADOS_ACUMULADOS' as const, debit: 0, credit: plug, memo: 'IVA neto que no era de Kampro' }
      : plug < 0
        ? { role: 'RESULTADOS_ACUMULADOS' as const, debit: -plug, credit: 0, memo: 'IVA neto que no era de Kampro' }
        : null,
  ].filter((line): line is NonNullable<typeof line> => line != null);

  const entry = await prisma.$transaction((tx) =>
    postEntry(tx, {
      datedAt: at(PAY_DATE),
      memo: 'Liquidación IVA Canale agosto — baja débito y crédito del prestador',
      sourceType: JournalSource.MANUAL,
      sourceId: IVA_ZERO_SOURCE,
      event: 'MANUAL',
      lines: draft,
    }),
  );
  console.log(`OK ${entry.numberLabel} baja IVA débito=${debito} crédito=${credito} patrimonio=${plug}`);
}

async function snapshot() {
  const lines = await prisma.journalLine.findMany({
    where: { account: { role: { in: ['IVA_DEBITO', 'IVA_CREDITO'] } } },
    include: { account: { select: { role: true } } },
  });
  let debito = 0;
  let credito = 0;
  for (const line of lines) {
    const role = line.account.role ?? '';
    const net = signedIva(role, line.debit, line.credit);
    if (role === 'IVA_DEBITO') debito += net;
    if (role === 'IVA_CREDITO') credito += net;
  }
  const expenses = await prisma.expense.findMany({
    where: { description: { contains: 'Pago de IVA Canale' } },
    orderBy: { number: 'asc' },
  });
  console.log(
    JSON.stringify(
      {
        ivaDebito: debito,
        ivaCredito: credito,
        payments: expenses.map((e) => ({
          numberLabel: e.numberLabel,
          datedAt: e.datedAt.toISOString().slice(0, 10),
          amount: e.amountGrossPyg,
          description: e.description,
        })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  await relabelJulyPayment();
  await payAugust();
  await zeroIvaBalances();
  await snapshot();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
