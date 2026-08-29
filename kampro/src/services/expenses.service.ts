import { ExpenseKind, JournalSource, type TreasuryAccount } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { postExpenseJournal } from './accounting.service.js';
import { reverseActive } from './journal.service.js';

const KIND_ROLE: Record<ExpenseKind, string> = {
  GENERAL: 'GASTOS_GENERALES',
  SALARIO: 'SUELDOS',
  PUBLICIDAD: 'PUBLICIDAD',
  OTRO: 'GASTOS_GENERALES',
};

export async function listExpenses() {
  return prisma.expense.findMany({
    include: { account: true },
    orderBy: { datedAt: 'desc' },
    take: 300,
  });
}

export async function createExpense(input: {
  kind: ExpenseKind;
  datedAt: Date;
  description: string;
  amountGrossPyg: number;
  ivaIncluded?: boolean;
  treasury: TreasuryAccount;
  accountId?: string;
  vendor?: string | null;
  reference?: string | null;
}) {
  const description = input.description.trim();
  if (!description) badRequest('La descripción del gasto es obligatoria');
  if (!Number.isInteger(input.amountGrossPyg) || input.amountGrossPyg < 1) {
    badRequest('El monto del gasto debe ser mayor a 0');
  }
  const ivaIncluded = input.ivaIncluded ?? input.kind !== ExpenseKind.SALARIO;
  let accountId = input.accountId;
  if (!accountId) {
    const role = KIND_ROLE[input.kind];
    const account = await prisma.account.findFirst({ where: { role: role as never } });
    if (!account) badRequest('No hay cuenta de gasto para este tipo');
    accountId = account.id;
  } else {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) notFound('Cuenta');
    if (account.type !== 'EXPENSE' && account.type !== 'COST') {
      badRequest('El gasto tiene que ir a una cuenta de gasto o costo');
    }
  }

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        kind: input.kind,
        datedAt: input.datedAt,
        description,
        amountGrossPyg: input.amountGrossPyg,
        ivaIncluded,
        treasury: input.treasury,
        accountId: accountId!,
        vendor: input.vendor?.trim() || null,
        reference: input.reference?.trim() || null,
      },
      include: { account: true },
    });
    const role = expense.account.role ?? KIND_ROLE[input.kind];
    await postExpenseJournal(tx, {
      id: expense.id,
      datedAt: input.datedAt,
      gross: input.amountGrossPyg,
      ivaIncluded,
      expenseRole: role || 'GASTOS_GENERALES',
      expenseAccountId: accountId,
      treasury: input.treasury,
      description,
    });
    return expense;
  });
}

export async function deleteExpense(id: string) {
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) notFound('Gasto');
  await prisma.$transaction(async (tx) => {
    await reverseActive(tx, JournalSource.EXPENSE, id, 'PAY', new Date());
    await tx.expense.delete({ where: { id } });
  });
}
