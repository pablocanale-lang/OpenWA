/**
 * Restaura los gastos de honorarios a Canale y Pei (G-000020 / G-000021).
 * No toca los aportes de capital A-000092 / A-000093.
 */
import 'dotenv/config';
import { ExpenseKind, TreasuryAccount } from '@prisma/client';
import { prisma } from '../src/db.js';
import { createExpense } from '../src/services/expenses.service.js';

const AMOUNT = 1_783_663;
const DATE = new Date('2026-09-30T00:00:00.000Z');

const existing = await prisma.expense.findMany({
  where: {
    description: {
      in: ['Pago por honorarios capital - Canale', 'Pago por honorarios capital - Pei'],
    },
  },
});
if (existing.length) {
  console.log(
    'already present',
    existing.map((row) => `${row.numberLabel} ${row.description}`).join(' | '),
  );
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.operationSequence.update({ where: { id: 'expense' }, data: { nextNumber: 20 } });

const canale = await createExpense({
  kind: ExpenseKind.GENERAL,
  datedAt: DATE,
  description: 'Pago por honorarios capital - Canale',
  amountGrossPyg: AMOUNT,
  ivaTreatment: 'EXENTA',
  treasury: TreasuryAccount.BANCO,
  vendor: 'Canale',
});
const pei = await createExpense({
  kind: ExpenseKind.GENERAL,
  datedAt: DATE,
  description: 'Pago por honorarios capital - Pei',
  amountGrossPyg: AMOUNT,
  ivaTreatment: 'EXENTA',
  treasury: TreasuryAccount.BANCO,
  vendor: 'Pei',
});

console.log('restored', canale.numberLabel, canale.description);
console.log('restored', pei.numberLabel, pei.description);

await prisma.$disconnect();
