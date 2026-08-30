import { ExpenseKind, JournalSource, type TreasuryAccount } from '@prisma/client';
import { prisma } from '../db.js';
import { parsePygInput } from '../domain/pyg-input.js';
import { badRequest, notFound } from '../http-error.js';
import { postExpenseJournal } from './accounting.service.js';
import { reverseActive } from './journal.service.js';
import { allocateOpNumber } from './operation-numbers.service.js';

function dayRangeUtc(datedAt: Date) {
  const start = new Date(Date.UTC(datedAt.getUTCFullYear(), datedAt.getUTCMonth(), datedAt.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

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
  const amountGrossPyg = parsePygInput(input.amountGrossPyg);
  if (!Number.isInteger(amountGrossPyg) || amountGrossPyg < 1) {
    badRequest('El monto del gasto debe ser un entero en guaraníes mayor a 0');
  }
  const day = dayRangeUtc(input.datedAt);
  const recent = await prisma.expense.findFirst({
    where: {
      description,
      amountGrossPyg,
      treasury: input.treasury,
      datedAt: { gte: day.start, lt: day.end },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    badRequest('Este gasto ya está cargado. Si es otro movimiento, cambiá la descripción.');
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
    const allocated = await allocateOpNumber(tx, 'expense');
    const expense = await tx.expense.create({
      data: {
        number: allocated.number,
        numberLabel: allocated.numberLabel,
        kind: input.kind,
        datedAt: input.datedAt,
        description,
        amountGrossPyg,
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
      gross: amountGrossPyg,
      ivaIncluded,
      expenseRole: role || 'GASTOS_GENERALES',
      expenseAccountId: accountId,
      treasury: input.treasury,
      description,
    });
    return expense;
  });
}

export async function updateExpense(
  id: string,
  input: {
    kind?: ExpenseKind;
    datedAt?: Date;
    description?: string;
    amountGrossPyg?: number;
    ivaIncluded?: boolean;
    treasury?: TreasuryAccount;
    accountId?: string;
    vendor?: string | null;
    reference?: string | null;
  },
) {
  const existing = await prisma.expense.findUnique({ where: { id }, include: { account: true } });
  if (!existing) notFound('Gasto');

  const description = input.description !== undefined ? input.description.trim() : existing.description;
  if (!description) badRequest('La descripción del gasto es obligatoria');
  const amountGrossPyg =
    input.amountGrossPyg !== undefined ? parsePygInput(input.amountGrossPyg) : existing.amountGrossPyg;
  if (!Number.isInteger(amountGrossPyg) || amountGrossPyg < 1) {
    badRequest('El monto del gasto debe ser un entero en guaraníes mayor a 0');
  }
  const kind = input.kind ?? existing.kind;
  const ivaIncluded =
    input.ivaIncluded !== undefined ? input.ivaIncluded : existing.ivaIncluded;
  let accountId = input.accountId ?? existing.accountId;
  if (input.accountId) {
    const account = await prisma.account.findUnique({ where: { id: input.accountId } });
    if (!account) notFound('Cuenta');
    if (account.type !== 'EXPENSE' && account.type !== 'COST') {
      badRequest('El gasto tiene que ir a una cuenta de gasto o costo');
    }
    accountId = account.id;
  } else if (input.kind && !input.accountId) {
    const role = KIND_ROLE[kind];
    const account = await prisma.account.findFirst({ where: { role: role as never } });
    if (!account) badRequest('No hay cuenta de gasto para este tipo');
    accountId = account.id;
  }

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.update({
      where: { id },
      data: {
        kind,
        datedAt: input.datedAt,
        description,
        amountGrossPyg,
        ivaIncluded,
        treasury: input.treasury,
        accountId,
        vendor: input.vendor === undefined ? undefined : input.vendor?.trim() || null,
        reference: input.reference === undefined ? undefined : input.reference?.trim() || null,
      },
      include: { account: true },
    });
    const role = expense.account.role ?? KIND_ROLE[expense.kind];
    await postExpenseJournal(tx, {
      id: expense.id,
      datedAt: expense.datedAt,
      gross: expense.amountGrossPyg,
      ivaIncluded: expense.ivaIncluded,
      expenseRole: role || 'GASTOS_GENERALES',
      expenseAccountId: expense.accountId,
      treasury: expense.treasury,
      description: expense.description,
      rewrite: true,
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
