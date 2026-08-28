import { prisma } from '../db.js';
import type { Prisma } from '@prisma/client';
import { DEFAULT_INVOICE_ISSUER, FIRST_INVOICE_NUMBER, formatInvoiceNumber } from '../domain/invoice-number.js';

type Tx = Prisma.TransactionClient;

export async function allocateInvoice(tx: Tx): Promise<{
  invoiceNumber: string;
  invoiceIssuer: string;
  invoiceIssuedAt: Date;
}> {
  const row = await tx.invoiceSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: FIRST_INVOICE_NUMBER, issuer: DEFAULT_INVOICE_ISSUER },
    update: {},
  });
  const invoiceNumber = formatInvoiceNumber(row.nextNumber);
  await tx.invoiceSequence.update({
    where: { id: 'default' },
    data: { nextNumber: row.nextNumber + 1 },
  });
  return {
    invoiceNumber,
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
