/**
 * Carga gastos operativos y de publicidad del Excel, asienta el IVA del
 * talonario ajeno y pasa la FC 001-001-0000005 a julio.
 * Idempotente: se puede volver a correr.
 */
import 'dotenv/config';
import { ExpenseKind, JournalSource, TreasuryAccount } from '@prisma/client';
import { prisma } from '../src/db.js';
import { HttpError } from '../src/http-error.js';
import { ensureSystemAccounts } from '../src/services/accounts.service.js';
import { createExpense } from '../src/services/expenses.service.js';
import { postEntry } from '../src/services/journal.service.js';
import { ensureOperationNumbers } from '../src/services/operation-numbers.service.js';

const TREASURY = TreasuryAccount.BANCO;
const INVOICE_0000005 = '001-001-0000005';
const INVOICE_0000005_DATE = '2026-07-31';
const IVA_ADJUST_SOURCE = 'iva-talonario-ajuste';

function at(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

type ExpenseRow = {
  datedAt: string;
  kind: ExpenseKind;
  description: string;
  amountGrossPyg: number;
  ivaIncluded: boolean;
  vendor?: string;
  reference?: string;
};

const EXPENSES: ExpenseRow[] = [
  {
    datedAt: '2026-08-10',
    kind: ExpenseKind.GENERAL,
    description: 'Pago de IVA Canale',
    amountGrossPyg: 214_670,
    ivaIncluded: false,
    vendor: 'Canale — talonario ajeno',
    reference: 'IVA prestador del talonario',
  },
  {
    datedAt: '2026-08-07',
    kind: ExpenseKind.GENERAL,
    description: 'Gasto por Afiliación comercial con el Ing. Carrillo',
    amountGrossPyg: 222_000,
    ivaIncluded: false,
    vendor: 'Ing. Carrillo',
  },
  {
    datedAt: '2026-07-07',
    kind: ExpenseKind.GENERAL,
    description: 'Gasto operativo por delivery para traslado de inventario',
    amountGrossPyg: 35_000,
    ivaIncluded: false,
  },
  {
    datedAt: '2026-08-14',
    kind: ExpenseKind.GENERAL,
    description: 'Gasto operativo por pago de estacionamiento',
    amountGrossPyg: 10_000,
    ivaIncluded: false,
  },
  {
    datedAt: '2026-08-24',
    kind: ExpenseKind.GENERAL,
    description: 'Gasto operativo por refrigerio',
    amountGrossPyg: 28_000,
    ivaIncluded: false,
  },
  {
    datedAt: '2026-08-25',
    kind: ExpenseKind.GENERAL,
    description: 'Gasto operativo por herramienta - Cursor IA',
    amountGrossPyg: 135_500,
    ivaIncluded: true,
    vendor: 'Cursor',
  },
  ...(
    [
      ['2026-08-04', 13_365],
      ['2026-08-05', 13_365],
      ['2026-08-06', 13_178],
      ['2026-08-10', 13_178],
      ['2026-08-10', 24_578],
      ['2026-08-13', 29_636],
      ['2026-08-17', 42_439],
      ['2026-08-24', 53_537],
      ['2026-08-27', 39_408],
    ] as const
  ).map(([datedAt, amountGrossPyg]) => ({
    datedAt,
    kind: ExpenseKind.PUBLICIDAD,
    description: 'Facebook - Meta ads',
    amountGrossPyg,
    ivaIncluded: true,
    vendor: 'Meta',
    reference: datedAt,
  })),
];

async function loadExpenses() {
  let created = 0;
  let skipped = 0;
  for (const row of EXPENSES) {
    try {
      const expense = await createExpense({
        kind: row.kind,
        datedAt: at(row.datedAt),
        description: row.description,
        amountGrossPyg: row.amountGrossPyg,
        ivaIncluded: row.ivaIncluded,
        treasury: TREASURY,
        vendor: row.vendor,
        reference: row.reference,
      });
      created += 1;
      console.log(`OK ${expense.numberLabel ?? expense.id} ${row.datedAt} ${row.amountGrossPyg} ${row.description}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HttpError && err.statusCode === 400 && message.includes('ya está cargado')) {
        skipped += 1;
        console.log(`SKIP ${row.datedAt} ${row.amountGrossPyg} ${row.description}`);
        continue;
      }
      throw err;
    }
  }
  console.log(`Gastos creados=${created} omitidos=${skipped}`);
}

async function settleBorrowedVat() {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: JournalSource.MANUAL, sourceId: IVA_ADJUST_SOURCE, event: 'MANUAL' },
  });
  if (existing) {
    console.log(`SKIP ajuste IVA (ya existe ${existing.numberLabel})`);
    return;
  }

  const ivaLines = await prisma.journalLine.findMany({
    where: { account: { role: { in: ['IVA_DEBITO', 'IVA_CREDITO'] } } },
    include: { account: { select: { role: true } }, entry: { select: { event: true } } },
  });

  let debito = 0;
  let retenciones = 0;
  for (const line of ivaLines) {
    if (line.account.role === 'IVA_DEBITO') debito += line.credit - line.debit;
    if (line.account.role === 'IVA_CREDITO' && line.entry.event === 'IVA_RET') {
      retenciones += line.debit - line.credit;
    }
  }

  if (debito < 1) {
    console.log('SKIP ajuste IVA (no hay IVA débito de ventas)');
    return;
  }
  if (retenciones < 0 || debito < retenciones) {
    throw new Error(`Ajuste IVA inconsistente: débito=${debito} retenciones=${retenciones}`);
  }

  const plug = debito - retenciones;
  const entry = await prisma.$transaction((tx) =>
    postEntry(tx, {
      datedAt: at('2026-08-10'),
      memo: 'Ajuste IVA talonario ajeno — no corresponde a Kampro',
      sourceType: JournalSource.MANUAL,
      sourceId: IVA_ADJUST_SOURCE,
      event: 'MANUAL',
      lines: [
        { role: 'IVA_DEBITO', debit: debito, credit: 0, memo: 'Baja IVA débito de facturas de talonario ajeno' },
        { role: 'IVA_CREDITO', debit: 0, credit: retenciones, memo: 'Baja retenciones que corresponden al prestador' },
        { role: 'RESULTADOS_ACUMULADOS', debit: 0, credit: plug, memo: 'IVA que no era de Kampro (crédito fiscal del prestador + resto)' },
      ],
    }),
  );
  console.log(
    `OK ${entry.numberLabel} ajuste IVA débito=${debito} retenciones=${retenciones} patrimonio=${plug} (IVA crédito de fletes se mantiene)`,
  );
}

async function moveInvoice0000005ToJuly() {
  const order = await prisma.order.findFirst({ where: { invoiceNumber: INVOICE_0000005 } });
  if (!order) {
    console.log('SKIP FC 001-001-0000005 (no está en esta base)');
    return;
  }
  const target = at(INVOICE_0000005_DATE);
  const current = order.invoiceIssuedAt;
  if (current && current.getUTCFullYear() === 2026 && current.getUTCMonth() === 6) {
    console.log(`SKIP FC 001-001-0000005 (ya está en julio: ${current.toISOString().slice(0, 10)})`);
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { invoiceIssuedAt: target, createdAt: target },
    });
    const journals = await tx.journalEntry.updateMany({
      where: { sourceType: JournalSource.ORDER, sourceId: order.id, event: { in: ['CLOSE', 'COGS'] } },
      data: { datedAt: target },
    });
    return journals.count;
  });
  console.log(
    `OK FC 001-001-0000005 Joaquin Clavel: factura y asientos de venta/CMV → ${INVOICE_0000005_DATE} (${updated} asientos). El cobro sigue en 2026-08-04.`,
  );
}

async function main() {
  await ensureSystemAccounts();
  await ensureOperationNumbers();
  await loadExpenses();
  await settleBorrowedVat();
  await moveInvoice0000005ToJuly();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
