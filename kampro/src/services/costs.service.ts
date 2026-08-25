import { ImportCostType } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { asString, dec } from '../money.js';

function serialize<T extends { amount: unknown; fxRateToPyg: unknown }>(row: T) {
  return {
    ...row,
    amount: asString(row.amount as never),
    fxRateToPyg: asString(row.fxRateToPyg as never),
  };
}

export async function listImportCosts(shipmentId?: string) {
  const rows = await prisma.importCost.findMany({
    where: shipmentId ? { shipmentId } : undefined,
    include: { shipment: true, purchase: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serialize);
}

export async function createImportCost(data: {
  shipmentId: string;
  purchaseId?: string;
  type: ImportCostType;
  description?: string;
  amount: string;
  currency?: string;
  fxRateToPyg?: string;
  incurredAt?: Date;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: data.shipmentId },
    include: { purchases: true },
  });
  if (!shipment) notFound('Envío');

  if (data.purchaseId) {
    const purchase = shipment.purchases.find((p) => p.id === data.purchaseId);
    if (!purchase) badRequest('La compra no pertenece a este envío');
  }

  const row = await prisma.importCost.create({
    data: {
      shipmentId: data.shipmentId,
      purchaseId: data.purchaseId,
      type: data.type,
      description: data.description,
      amount: dec(data.amount),
      currency: data.currency ?? 'USD',
      fxRateToPyg: data.fxRateToPyg ? dec(data.fxRateToPyg) : undefined,
      incurredAt: data.incurredAt,
    },
    include: { shipment: true, purchase: { include: { product: true } } },
  });
  return serialize(row);
}

export async function updateImportCost(
  id: string,
  data: {
    type?: ImportCostType;
    description?: string | null;
    amount?: string;
    currency?: string;
    fxRateToPyg?: string | null;
    incurredAt?: Date | null;
    purchaseId?: string | null;
  },
) {
  const existing = await prisma.importCost.findUnique({ where: { id } });
  if (!existing) notFound('Costo de importación');

  const row = await prisma.importCost.update({
    where: { id },
    data: {
      type: data.type,
      description: data.description,
      amount: data.amount !== undefined ? dec(data.amount) : undefined,
      currency: data.currency,
      fxRateToPyg: data.fxRateToPyg === null ? null : data.fxRateToPyg ? dec(data.fxRateToPyg) : undefined,
      incurredAt: data.incurredAt,
      purchaseId: data.purchaseId,
    },
    include: { shipment: true, purchase: { include: { product: true } } },
  });
  return serialize(row);
}

export async function deleteImportCost(id: string) {
  const existing = await prisma.importCost.findUnique({ where: { id } });
  if (!existing) notFound('Costo de importación');
  await prisma.importCost.delete({ where: { id } });
}
