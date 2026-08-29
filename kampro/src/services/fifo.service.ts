import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest } from '../http-error.js';
import { consumeFifo } from '../domain/fifo.js';

type Tx = Prisma.TransactionClient;

export async function addLot(
  tx: Tx,
  input: {
    productId: string;
    purchaseOrderId?: string | null;
    receivedAt: Date;
    quantity: number;
    unitCostPyg: number;
  },
) {
  if (input.quantity <= 0) return null;
  return tx.inventoryLot.create({
    data: {
      productId: input.productId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      receivedAt: input.receivedAt,
      qtyOriginal: input.quantity,
      qtyRemaining: input.quantity,
      unitCostPyg: Math.max(0, Math.round(input.unitCostPyg)),
    },
  });
}

async function backfillLotIfShort(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { inventoryLots: true },
  });
  if (!product) return;
  const lotQty = product.inventoryLots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
  const missing = product.stockQty - lotQty;
  if (missing > 0) {
    await addLot(tx, {
      productId,
      receivedAt: product.createdAt,
      quantity: missing,
      unitCostPyg: product.unitCostPyg ?? 0,
    });
  }
}

export async function ensureLotsMatchOnHand() {
  const products = await prisma.product.findMany({ include: { inventoryLots: true } });
  for (const product of products) {
    await prisma.$transaction((tx) => backfillLotIfShort(tx, product.id));
  }
}

export async function consumeForOrder(tx: Tx, orderId: string, productId: string, quantity: number) {
  if (quantity <= 0) return { takes: [], totalCostPyg: 0 };
  await backfillLotIfShort(tx, productId);
  const lots = await tx.inventoryLot.findMany({
    where: { productId, qtyRemaining: { gt: 0 } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });
  let takes;
  try {
    ({ takes } = consumeFifo(lots, quantity));
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No hay stock PEPS suficiente');
  }
  let totalCostPyg = 0;
  for (const take of takes) {
    await tx.inventoryLot.update({
      where: { id: take.lotId },
      data: { qtyRemaining: { decrement: take.quantity } },
    });
    await tx.lotConsumption.create({
      data: {
        lotId: take.lotId,
        orderId,
        quantity: take.quantity,
        unitCostPyg: take.unitCostPyg,
      },
    });
    totalCostPyg += take.costPyg;
  }
  return { takes, totalCostPyg };
}

export async function restoreForOrder(tx: Tx, orderId: string) {
  const rows = await tx.lotConsumption.findMany({ where: { orderId } });
  let totalCostPyg = 0;
  for (const row of rows) {
    await tx.inventoryLot.update({
      where: { id: row.lotId },
      data: { qtyRemaining: { increment: row.quantity } },
    });
    totalCostPyg += row.quantity * row.unitCostPyg;
  }
  await tx.lotConsumption.deleteMany({ where: { orderId } });
  return { totalCostPyg, quantity: rows.reduce((s, r) => s + r.quantity, 0) };
}

export async function removeLotsForPurchaseOrder(tx: Tx, purchaseOrderId: string) {
  const lots = await tx.inventoryLot.findMany({ where: { purchaseOrderId }, include: { consumptions: true } });
  for (const lot of lots) {
    if (lot.consumptions.length) {
      badRequest('No se puede cancelar: parte de este lote ya se vendió. Hay que devolver esas ventas primero.');
    }
    if (lot.qtyRemaining !== lot.qtyOriginal) {
      badRequest('No se puede cancelar: el lote ya no está completo en inventario');
    }
  }
  await tx.inventoryLot.deleteMany({ where: { purchaseOrderId } });
}

export async function consumeAdjustment(tx: Tx, productId: string, quantity: number) {
  await backfillLotIfShort(tx, productId);
  const lots = await tx.inventoryLot.findMany({
    where: { productId, qtyRemaining: { gt: 0 } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });
  let takes;
  try {
    ({ takes } = consumeFifo(lots, quantity));
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No hay stock PEPS suficiente para el ajuste');
  }
  let totalCostPyg = 0;
  for (const take of takes) {
    await tx.inventoryLot.update({
      where: { id: take.lotId },
      data: { qtyRemaining: { decrement: take.quantity } },
    });
    totalCostPyg += take.costPyg;
  }
  return { takes, totalCostPyg };
}
