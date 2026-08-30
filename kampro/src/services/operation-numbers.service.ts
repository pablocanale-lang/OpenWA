import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { formatOpNumber, type OpKind } from '../domain/operation-number.js';

type Tx = Prisma.TransactionClient;

export async function allocateOpNumber(tx: Tx, kind: OpKind) {
  const seq = await tx.operationSequence.upsert({
    where: { id: kind },
    create: { id: kind, nextNumber: 1 },
    update: {},
  });
  const number = seq.nextNumber;
  await tx.operationSequence.update({ where: { id: kind }, data: { nextNumber: number + 1 } });
  return { number, numberLabel: formatOpNumber(kind, number) };
}

async function backfill(
  kind: OpKind,
  rows: Array<{ id: string; number: number | null }>,
  update: (id: string, number: number, numberLabel: string) => Promise<unknown>,
) {
  let next = 1;
  for (const row of rows) {
    if (row.number && row.number > 0) {
      if (row.number >= next) next = row.number + 1;
      continue;
    }
    await update(row.id, next, formatOpNumber(kind, next));
    next += 1;
  }
  await prisma.operationSequence.upsert({
    where: { id: kind },
    create: { id: kind, nextNumber: next },
    update: { nextNumber: next },
  });
}

export async function ensureOperationNumbers() {
  const [pos, orders, expenses] = await Promise.all([
    prisma.purchaseOrder.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, number: true } }),
    prisma.order.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, number: true } }),
    prisma.expense.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, number: true } }),
  ]);
  await backfill('purchase-order', pos, (id, number, numberLabel) =>
    prisma.purchaseOrder.update({ where: { id }, data: { number, numberLabel } }),
  );
  await backfill('order', orders, (id, number, numberLabel) =>
    prisma.order.update({ where: { id }, data: { number, numberLabel } }),
  );
  await backfill('expense', expenses, (id, number, numberLabel) =>
    prisma.expense.update({ where: { id }, data: { number, numberLabel } }),
  );
}
