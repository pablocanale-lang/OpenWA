import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import { badRequest } from '../http-error.js';
import {
  DEFAULT_INVOICE_ISSUER,
  FIRST_INVOICE_NUMBER,
  formatInvoiceNumber,
  normalizeInvoiceNumber,
  parseInvoiceNumber,
  sequenceAfterAssign,
} from '../domain/invoice-number.js';

type Tx = Prisma.TransactionClient;

export type IssuedInvoice = {
  invoiceNumber: string;
  invoiceIssuer: string;
  invoiceIssuedAt: Date;
};

async function sequenceRow(tx: Tx) {
  return tx.invoiceSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: FIRST_INVOICE_NUMBER, issuer: DEFAULT_INVOICE_ISSUER },
    update: {},
  });
}

function parseOrBadRequest(raw: string): string {
  try {
    return normalizeInvoiceNumber(raw);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Número de factura inválido');
  }
}

async function assertAvailable(tx: Tx, invoiceNumber: string, excludeOrderId?: string) {
  const clash = await tx.order.findFirst({
    where: {
      invoiceNumber,
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { numberLabel: true },
  });
  if (clash) {
    badRequest(`La factura ${invoiceNumber} ya está en ${clash.numberLabel || 'otro pedido'}`);
  }
}

async function nextFreeNumber(db: Tx | typeof prisma, start: number) {
  let sequence = start;
  let invoiceNumber = formatInvoiceNumber(sequence);
  for (let i = 0; i < 50; i += 1) {
    const used = await db.order.findFirst({
      where: { invoiceNumber },
      select: { id: true },
    });
    if (!used) return { sequence, invoiceNumber };
    sequence += 1;
    invoiceNumber = formatInvoiceNumber(sequence);
  }
  return { sequence, invoiceNumber };
}

async function bumpSequence(tx: Tx, assignedSequence: number) {
  const row = await sequenceRow(tx);
  const nextNumber = sequenceAfterAssign(row.nextNumber, assignedSequence);
  if (nextNumber !== row.nextNumber) {
    await tx.invoiceSequence.update({ where: { id: 'default' }, data: { nextNumber } });
  }
  return row.issuer || DEFAULT_INVOICE_ISSUER;
}

export async function peekNextInvoice(tx?: Tx): Promise<{ invoiceNumber: string; invoiceIssuer: string }> {
  const db = tx ?? prisma;
  const row = await db.invoiceSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: FIRST_INVOICE_NUMBER, issuer: DEFAULT_INVOICE_ISSUER },
    update: {},
  });
  const next = await nextFreeNumber(db, row.nextNumber);
  return {
    invoiceNumber: next.invoiceNumber,
    invoiceIssuer: row.issuer || DEFAULT_INVOICE_ISSUER,
  };
}

export async function applyInvoiceNumber(
  tx: Tx,
  input: { invoiceNumber: string; excludeOrderId?: string },
): Promise<IssuedInvoice> {
  const invoiceNumber = parseOrBadRequest(input.invoiceNumber);
  await assertAvailable(tx, invoiceNumber, input.excludeOrderId);
  const parsed = parseInvoiceNumber(invoiceNumber);
  const invoiceIssuer = await bumpSequence(tx, parsed.sequence);
  return {
    invoiceNumber,
    invoiceIssuer,
    invoiceIssuedAt: new Date(),
  };
}

export async function allocateInvoice(tx: Tx, override?: string | null): Promise<IssuedInvoice> {
  if (override?.trim()) {
    return applyInvoiceNumber(tx, { invoiceNumber: override });
  }

  const row = await sequenceRow(tx);
  const next = await nextFreeNumber(tx, row.nextNumber);
  await assertAvailable(tx, next.invoiceNumber);
  await tx.invoiceSequence.update({
    where: { id: 'default' },
    data: { nextNumber: sequenceAfterAssign(row.nextNumber, next.sequence) },
  });
  return {
    invoiceNumber: next.invoiceNumber,
    invoiceIssuer: row.issuer || DEFAULT_INVOICE_ISSUER,
    invoiceIssuedAt: new Date(),
  };
}

export async function ensureInvoiceSequence() {
  await prisma.invoiceSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: FIRST_INVOICE_NUMBER, issuer: DEFAULT_INVOICE_ISSUER },
    update: {},
  });
}
