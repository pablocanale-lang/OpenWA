import { CashFlowClass, JournalSource, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { assertBalanced, compactDraftLines, formatJournalNumber, reverseLines, type DraftLine } from '../domain/journal.js';
import { roleIds } from './accounts.service.js';

type Tx = Prisma.TransactionClient;
const entryInclude = {
  lines: { include: { account: true }, orderBy: { sortOrder: 'asc' as const } },
  reversedBy: { select: { id: true, numberLabel: true } },
};

export async function findActiveEntry(tx: Tx, sourceType: JournalSource, sourceId: string, event: string) {
  const rows = await tx.journalEntry.findMany({
    where: { sourceType, sourceId, event },
    include: { ...entryInclude, reversedBy: true },
    orderBy: { number: 'desc' },
  });
  return rows.find((row) => !row.reversedBy) ?? null;
}

async function resolveLines(tx: Tx, lines: DraftLine[]) {
  const compact = compactDraftLines(lines);
  assertBalanced(compact);
  const roles = await roleIds(tx);
  return compact.map((line, sortOrder) => {
    let accountId = line.accountId;
    if (!accountId && line.role) accountId = roles.get(line.role as never);
    if (!accountId) badRequest(`No hay cuenta contable para ${line.role ?? 'esta línea'}`);
    return {
      accountId,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo ?? null,
      productId: line.productId ?? null,
      quantity: line.quantity ?? null,
      sortOrder,
    };
  });
}

export async function postEntry(
  tx: Tx,
  input: {
    datedAt: Date;
    memo: string;
    sourceType: JournalSource;
    sourceId: string;
    event: string;
    lines: DraftLine[];
    cashFlow?: CashFlowClass;
    skipIfExists?: boolean;
  },
) {
  if (input.skipIfExists !== false) {
    const existing = await findActiveEntry(tx, input.sourceType, input.sourceId, input.event);
    if (existing) return existing;
  }
  const resolved = await resolveLines(tx, input.lines);
  const allocated = await allocateNumber(tx);
  return tx.journalEntry.create({
    data: {
      number: allocated.number,
      numberLabel: allocated.label,
      datedAt: input.datedAt,
      memo: input.memo.trim(),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      event: input.event,
      cashFlow: input.cashFlow ?? CashFlowClass.OPERATING,
      lines: { create: resolved },
    },
    include: entryInclude,
  });
}

export async function reverseEntry(tx: Tx, entryId: string, datedAt: Date, memo?: string) {
  const original = await tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true, reversedBy: true } });
  if (!original) notFound('Asiento');
  if (original.reversedBy) {
    return tx.journalEntry.findUniqueOrThrow({ where: { id: original.reversedBy.id }, include: entryInclude });
  }
  const allocated = await allocateNumber(tx);
  return tx.journalEntry.create({
    data: {
      number: allocated.number,
      numberLabel: allocated.label,
      datedAt,
      memo: memo?.trim() || `Reversión ${original.numberLabel}`,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      event: `${original.event}_REV`,
      cashFlow: original.cashFlow,
      reversesId: original.id,
      lines: {
        create: reverseLines(original.lines).map((line, sortOrder) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo,
          productId: line.productId,
          quantity: line.quantity,
          sortOrder,
        })),
      },
    },
    include: entryInclude,
  });
}

async function allocateNumber(tx: Tx) {
  const seq = await tx.journalSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: 1 },
    update: {},
  });
  const number = seq.nextNumber;
  await tx.journalSequence.update({ where: { id: 'default' }, data: { nextNumber: number + 1 } });
  return { number, label: formatJournalNumber(number) };
}

export async function reverseActive(
  tx: Tx,
  sourceType: JournalSource,
  sourceId: string,
  event: string,
  datedAt: Date,
) {
  const active = await findActiveEntry(tx, sourceType, sourceId, event);
  if (!active) return null;
  return reverseEntry(tx, active.id, datedAt);
}

export async function replaceEntry(
  tx: Tx,
  input: Parameters<typeof postEntry>[1],
) {
  await reverseActive(tx, input.sourceType, input.sourceId, input.event, input.datedAt);
  return postEntry(tx, { ...input, skipIfExists: false });
}

/** Corrige el asiento activo (mismo número) cuando se edita la operación de origen. */
export async function rewriteActiveEntry(tx: Tx, input: Parameters<typeof postEntry>[1]) {
  const existing = await findActiveEntry(tx, input.sourceType, input.sourceId, input.event);
  if (!existing) {
    return postEntry(tx, { ...input, skipIfExists: false });
  }
  const resolved = await resolveLines(tx, input.lines);
  await tx.journalLine.deleteMany({ where: { entryId: existing.id } });
  return tx.journalEntry.update({
    where: { id: existing.id },
    data: {
      datedAt: input.datedAt,
      memo: input.memo.trim(),
      cashFlow: input.cashFlow ?? existing.cashFlow,
      lines: { create: resolved },
    },
    include: entryInclude,
  });
}

async function documentBySource(entries: Array<{ sourceType: JournalSource; sourceId: string }>) {
  const ids = (type: JournalSource) => [...new Set(entries.filter((e) => e.sourceType === type).map((e) => e.sourceId))];
  const orderIds = ids(JournalSource.ORDER);
  const paymentIds = ids(JournalSource.PAYMENT);
  const expenseIds = ids(JournalSource.EXPENSE);
  const poIds = ids(JournalSource.PURCHASE_ORDER);
  const [orders, payments, expenses, purchaseOrders] = await Promise.all([
    orderIds.length
      ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, invoiceNumber: true } })
      : [],
    paymentIds.length
      ? prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, reference: true, order: { select: { invoiceNumber: true } } },
        })
      : [],
    expenseIds.length
      ? prisma.expense.findMany({ where: { id: { in: expenseIds } }, select: { id: true, reference: true } })
      : [],
    poIds.length
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: { id: true, invoices: { select: { invoiceNumber: true }, take: 1, orderBy: { issuedAt: 'desc' } } },
        })
      : [],
  ]);
  const orderMap = new Map(orders.map((row) => [row.id, row.invoiceNumber]));
  const paymentMap = new Map(
    payments.map((row) => [row.id, row.reference || row.order.invoiceNumber]),
  );
  const expenseMap = new Map(expenses.map((row) => [row.id, row.reference]));
  const poMap = new Map(purchaseOrders.map((row) => [row.id, row.invoices[0]?.invoiceNumber ?? null]));
  return (sourceType: JournalSource, sourceId: string): string | null => {
    if (sourceType === JournalSource.ORDER) return orderMap.get(sourceId) ?? null;
    if (sourceType === JournalSource.PAYMENT) return paymentMap.get(sourceId) ?? null;
    if (sourceType === JournalSource.EXPENSE) return expenseMap.get(sourceId) ?? null;
    if (sourceType === JournalSource.PURCHASE_ORDER) return poMap.get(sourceId) ?? null;
    return null;
  };
}

function presentEntry<T extends { sourceType: JournalSource; sourceId: string; reversedBy?: { id: string } | null }>(
  entry: T,
  documentOf: (sourceType: JournalSource, sourceId: string) => string | null,
) {
  return {
    ...entry,
    reversed: Boolean(entry.reversedBy),
    documentNumber: documentOf(entry.sourceType, entry.sourceId),
  };
}

export async function listEntries(filters?: { from?: Date; to?: Date; sourceId?: string; accountId?: string }) {
  const rows = await prisma.journalEntry.findMany({
    where: {
      datedAt: filters?.from || filters?.to ? { gte: filters.from, lte: filters.to } : undefined,
      sourceId: filters?.sourceId,
      lines: filters?.accountId ? { some: { accountId: filters.accountId } } : undefined,
    },
    include: entryInclude,
    orderBy: { number: 'desc' },
    take: 500,
  });
  const documentOf = await documentBySource(rows);
  return rows.map((row) => presentEntry(row, documentOf));
}

export async function getEntry(id: string) {
  const entry = await prisma.journalEntry.findUnique({ where: { id }, include: entryInclude });
  if (!entry) notFound('Asiento');
  const documentOf = await documentBySource([entry]);
  return presentEntry(entry, documentOf);
}

export async function ledger(accountId: string, from?: Date, to?: Date) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) notFound('Cuenta');
  const lines = await prisma.journalLine.findMany({
    where: {
      accountId,
      entry: {
        datedAt: from || to ? { gte: from, lte: to } : undefined,
      },
    },
    include: { entry: true },
    orderBy: [{ entry: { datedAt: 'asc' } }, { entry: { number: 'asc' } }],
  });
  const creditNormal = account.type === 'LIABILITY' || account.type === 'EQUITY' || account.type === 'INCOME';
  let balance = 0;
  const rows = lines.map((line) => {
    balance += creditNormal ? line.credit - line.debit : line.debit - line.credit;
    return { ...line, balance };
  });
  return { account, rows, balance };
}

type StatementAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  role: string | null;
  debit: number;
  credit: number;
  balance: number;
};

function signedBalance(type: string, debit: number, credit: number) {
  const raw = debit - credit;
  if (type === 'LIABILITY' || type === 'EQUITY' || type === 'INCOME') return credit - debit;
  return raw;
}

export async function trialBalances(from?: Date, to?: Date) {
  const accounts = await prisma.account.findMany({ where: { active: true, postable: true }, orderBy: { code: 'asc' } });
  const grouped = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: from || to ? { entry: { datedAt: { gte: from, lte: to } } } : undefined,
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(grouped.map((g) => [g.accountId, g._sum]));
  const rows: StatementAccount[] = accounts.map((account) => {
    const sum = byId.get(account.id);
    const debit = sum?.debit ?? 0;
    const credit = sum?.credit ?? 0;
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      role: account.role,
      debit,
      credit,
      balance: signedBalance(account.type, debit, credit),
    };
  });
  return rows;
}

function withResultado(equity: StatementAccount[], netIncome: number): StatementAccount[] {
  return [
    ...equity,
    {
      id: 'resultado',
      code: '3.1.03',
      name: 'Resultado del ejercicio',
      type: 'EQUITY',
      role: 'RESULTADO_EJERCICIO',
      debit: 0,
      credit: 0,
      balance: netIncome,
    },
  ];
}

export async function financialStatements(from: Date, to: Date) {
  const period = await trialBalances(from, to);
  const allTime = await trialBalances(undefined, to);
  const prior = await trialBalances(undefined, new Date(from.getTime() - 1));
  const income = period.filter((a) => a.type === 'INCOME');
  const costs = period.filter((a) => a.type === 'COST');
  const expenses = period.filter((a) => a.type === 'EXPENSE');
  const taxes = period.filter((a) => a.role === 'IVA_DEBITO' || a.role === 'IVA_CREDITO');
  const revenue = income.reduce((s, a) => s + a.balance, 0);
  const costTotal = costs.reduce((s, a) => s + a.balance, 0);
  const expenseTotal = expenses.reduce((s, a) => s + a.balance, 0);
  const taxTotal = taxes.reduce((s, a) => s + a.balance, 0);
  const netIncome = revenue - costTotal - expenseTotal;

  const assets = allTime.filter((a) => a.type === 'ASSET');
  const currentAssets = assets.filter((a) => a.code.startsWith('1.1'));
  const nonCurrentAssets = assets.filter((a) => a.code.startsWith('1.2'));
  const liabilities = allTime.filter((a) => a.type === 'LIABILITY');
  const currentLiabilities = liabilities.filter((a) => a.code.startsWith('2.1'));
  const equity = allTime.filter((a) => a.type === 'EQUITY' && a.code !== '3.1.03');
  const equityRows = withResultado(equity, netIncome);
  const equityTotal = equityRows.reduce((s, a) => s + a.balance, 0);

  const treasuryIds = new Set(
    (await prisma.account.findMany({ where: { role: { in: ['CAJA', 'BANCO'] } } })).map((a) => a.id),
  );
  const cashLines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: [...treasuryIds] },
      entry: { datedAt: { gte: from, lte: to } },
    },
    include: { entry: true, account: true },
    orderBy: [{ entry: { number: 'desc' } }, { sortOrder: 'asc' }],
  });
  const cashFlow = { operating: 0, investing: 0, financing: 0 };
  let inflows = 0;
  let outflows = 0;
  for (const line of cashLines) {
    const net = line.debit - line.credit;
    inflows += line.debit;
    outflows += line.credit;
    if (line.entry.cashFlow === 'INVESTING') cashFlow.investing += net;
    else if (line.entry.cashFlow === 'FINANCING') cashFlow.financing += net;
    else cashFlow.operating += net;
  }
  const opening = prior
    .filter((a) => a.role === 'CAJA' || a.role === 'BANCO')
    .reduce((s, a) => s + a.balance, 0);
  const net = cashFlow.operating + cashFlow.investing + cashFlow.financing;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    incomeStatement: {
      income,
      costs,
      expenses,
      taxes,
      revenue,
      costTotal,
      expenseTotal,
      taxTotal,
      grossMargin: revenue - costTotal,
      netIncome,
    },
    balanceSheet: {
      currentAssets,
      nonCurrentAssets,
      assets,
      currentLiabilities,
      liabilities,
      equity: equityRows,
      currentAssetTotal: currentAssets.reduce((s, a) => s + a.balance, 0),
      nonCurrentAssetTotal: nonCurrentAssets.reduce((s, a) => s + a.balance, 0),
      assetTotal: assets.reduce((s, a) => s + a.balance, 0),
      currentLiabilityTotal: currentLiabilities.reduce((s, a) => s + a.balance, 0),
      liabilityTotal: liabilities.reduce((s, a) => s + a.balance, 0),
      equityTotal,
    },
    cashFlow: {
      ...cashFlow,
      opening,
      inflows,
      outflows,
      net,
      closing: opening + net,
      lines: cashLines.map((line) => ({
        datedAt: line.entry.datedAt,
        numberLabel: line.entry.numberLabel,
        memo: line.entry.memo,
        account: line.account.name,
        debit: line.debit,
        credit: line.credit,
        net: line.debit - line.credit,
        class: line.entry.cashFlow,
        sourceType: line.entry.sourceType,
        sourceId: line.entry.sourceId,
        event: line.entry.event,
      })),
    },
  };
}

export async function postManual(
  datedAt: Date,
  memo: string,
  lines: Array<{ accountId: string; debit: number; credit: number; memo?: string }>,
) {
  if (!memo.trim()) badRequest('El asiento manual necesita una descripción');
  const id = `manual-${Date.now()}`;
  return prisma.$transaction((tx) =>
    postEntry(tx, {
      datedAt,
      memo,
      sourceType: JournalSource.MANUAL,
      sourceId: id,
      event: 'MANUAL',
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        memo: line.memo,
      })),
      skipIfExists: false,
    }),
  );
}
