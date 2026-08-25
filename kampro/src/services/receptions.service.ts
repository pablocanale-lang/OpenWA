import { Prisma, ReceptionIncidentType, ShipmentStatus, StockMovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { allocateCosts } from '../domain/landed-cost.js';
import { badRequest, notFound } from '../http-error.js';
import { asString } from '../money.js';

function serializeReception<
  T extends {
    purchase: { unitPrice: unknown; total: unknown; fxRateToPyg: unknown };
  },
>(row: T) {
  return {
    ...row,
    purchase: {
      ...row.purchase,
      unitPrice: asString(row.purchase.unitPrice as never),
      total: asString(row.purchase.total as never),
      fxRateToPyg: asString(row.purchase.fxRateToPyg as never),
    },
  };
}

export async function listReceptions() {
  const rows = await prisma.reception.findMany({
    include: {
      incidents: true,
      purchase: { include: { product: true, supplier: true } },
      shipment: { include: { forwarder: true } },
    },
    orderBy: { receivedAt: 'desc' },
  });
  return rows.map(serializeReception);
}

export async function getReception(id: string) {
  const row = await prisma.reception.findUnique({
    where: { id },
    include: {
      incidents: true,
      purchase: { include: { product: true } },
      shipment: true,
      movements: true,
    },
  });
  if (!row) notFound('Recepción');
  return serializeReception(row);
}

export async function createReception(data: {
  shipmentId: string;
  purchaseId: string;
  receivedQty: number;
  receivedAt: Date;
  notes?: string;
  incidents?: Array<{ type: ReceptionIncidentType; quantity: number; notes?: string }>;
}) {
  if (data.receivedQty < 0) badRequest('La cantidad recibida no puede ser negativa');

  const purchase = await prisma.purchase.findUnique({
    where: { id: data.purchaseId },
    include: { receptions: true, product: true, shipment: { include: { costs: true, purchases: { include: { product: true, supplier: true } } } } },
  });
  if (!purchase) notFound('Compra');
  if (!purchase.shipmentId) badRequest('La compra debe estar asignada a un envío antes de recepcionar');
  if (purchase.shipmentId !== data.shipmentId) badRequest('La compra no pertenece a este envío');

  const alreadyReceived = purchase.receptions.reduce((s, r) => s + r.receivedQty, 0);
  const incidents = [...(data.incidents ?? [])];

  if (data.receivedQty !== purchase.quantity - alreadyReceived && incidents.length === 0) {
    const diff = data.receivedQty - (purchase.quantity - alreadyReceived);
    incidents.push({
      type: diff < 0 ? ReceptionIncidentType.FALTANTE : ReceptionIncidentType.SOBRANTE,
      quantity: Math.abs(diff),
      notes: 'Generada automáticamente por diferencia vs cantidad comprada pendiente',
    });
  }

  const damaged = incidents
    .filter((i) => i.type === ReceptionIncidentType.DANADO)
    .reduce((s, i) => s + i.quantity, 0);
  if (damaged > data.receivedQty) badRequest('Las unidades dañadas no pueden superar la cantidad recibida');
  const stockDelta = data.receivedQty - damaged;
  if (stockDelta < 0) badRequest('El ingreso a stock no puede ser negativo');

  const result = await prisma.$transaction(async (tx) => {
    const reception = await tx.reception.create({
      data: {
        shipmentId: data.shipmentId,
        purchaseId: data.purchaseId,
        receivedQty: data.receivedQty,
        receivedAt: data.receivedAt,
        notes: data.notes,
        incidents: incidents.length
          ? { create: incidents.map((i) => ({ type: i.type, quantity: i.quantity, notes: i.notes })) }
          : undefined,
      },
      include: { incidents: true },
    });

    if (stockDelta > 0) {
      await tx.product.update({
        where: { id: purchase.productId },
        data: { stockQty: { increment: stockDelta } },
      });
      await tx.stockMovement.create({
        data: {
          productId: purchase.productId,
          quantity: stockDelta,
          reason: StockMovementReason.RECEPCION,
          receptionId: reception.id,
          notes: data.notes,
        },
      });
    }

    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: data.shipmentId },
      include: { purchases: { include: { receptions: true } } },
    });
    const allReceived = shipment.purchases.every((p) => p.receptions.reduce((s, r) => s + r.receivedQty, 0) > 0);
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: allReceived ? ShipmentStatus.RECEPCIONADO : ShipmentStatus.LLEGADO,
        arrivedAt: shipment.arrivedAt ?? data.receivedAt,
      },
    });

    const unitCostPyg = await computeUnitCostPyg(purchase.productId, tx);
    if (unitCostPyg !== null) {
      await tx.product.update({ where: { id: purchase.productId }, data: { unitCostPyg } });
    }

    return tx.reception.findUniqueOrThrow({
      where: { id: reception.id },
      include: {
        incidents: true,
        purchase: { include: { product: true } },
        shipment: { include: { forwarder: true } },
        movements: true,
      },
    });
  });

  return serializeReception(result);
}

async function computeUnitCostPyg(productId: string, tx: Prisma.TransactionClient): Promise<number | null> {
  const purchases = await tx.purchase.findMany({
    where: { productId },
    include: {
      product: true,
      supplier: true,
      shipment: { include: { costs: true, purchases: { include: { product: true, supplier: true } } } },
      receptions: true,
    },
  });

  const rows = [];
  for (const purchase of purchases) {
    if (!purchase.shipment) continue;
    const allocated = allocateCosts(
      purchase.shipment.purchases.map((p) => ({
        id: p.id,
        productId: p.productId,
        sku: p.product.sku,
        quantity: p.quantity,
        unitPrice: asString(p.unitPrice) ?? '0',
        total: asString(p.total) ?? '0',
        currency: p.currency,
        fxRateToPyg: asString(p.fxRateToPyg),
        purchasedAt: p.purchasedAt,
        supplierName: p.supplier.name,
        shipmentReference: purchase.shipment!.reference,
      })),
      purchase.shipment.costs.map((c) => ({
        id: c.id,
        purchaseId: c.purchaseId,
        type: c.type,
        description: c.description,
        amount: asString(c.amount) ?? '0',
        currency: c.currency,
        fxRateToPyg: asString(c.fxRateToPyg),
      })),
    );
    const mine = allocated.find((r) => r.purchase.id === purchase.id);
    if (mine) rows.push(mine);
  }

  const withLanded = rows.filter((r) => r.landedPyg !== null);
  if (!withLanded.length || withLanded.length !== rows.length) return null;
  const qty = withLanded.reduce((s, r) => s + r.purchase.quantity, 0);
  const landed = withLanded.reduce((s, r) => s + (r.landedPyg ?? 0), 0);
  if (qty <= 0) return null;
  return Math.round(landed / qty);
}
