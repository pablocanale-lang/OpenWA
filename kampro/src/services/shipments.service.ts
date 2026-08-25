import { ShipmentStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { asString } from '../money.js';

const include = {
  forwarder: true,
  purchases: { include: { product: true, supplier: true, receptions: true } },
  costs: true,
  receptions: { include: { incidents: true, purchase: { include: { product: true } } } },
} as const;

function serializeShipment<T extends { costs: Array<{ amount: unknown; fxRateToPyg: unknown }>; purchases: Array<{ unitPrice: unknown; total: unknown; fxRateToPyg: unknown }> }>(
  row: T,
) {
  return {
    ...row,
    costs: row.costs.map((c) => ({
      ...c,
      amount: asString(c.amount as never),
      fxRateToPyg: asString(c.fxRateToPyg as never),
    })),
    purchases: row.purchases.map((p) => ({
      ...p,
      unitPrice: asString(p.unitPrice as never),
      total: asString(p.total as never),
      fxRateToPyg: asString(p.fxRateToPyg as never),
    })),
  };
}

export async function listShipments() {
  const rows = await prisma.shipment.findMany({
    include,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeShipment);
}

export async function getShipment(id: string) {
  const row = await prisma.shipment.findUnique({ where: { id }, include });
  if (!row) notFound('Envío');
  return serializeShipment(row);
}

export async function createShipment(data: {
  forwarderId: string;
  reference: string;
  departedAt?: Date;
  etaAt?: Date;
  arrivedAt?: Date;
  notes?: string;
  purchaseIds?: string[];
}) {
  const forwarder = await prisma.forwarder.findUnique({ where: { id: data.forwarderId } });
  if (!forwarder) notFound('Forwarder');

  const status = deriveStatus({
    departedAt: data.departedAt ?? null,
    arrivedAt: data.arrivedAt ?? null,
    hasReception: false,
  });

  const row = await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        forwarderId: data.forwarderId,
        reference: data.reference,
        departedAt: data.departedAt,
        etaAt: data.etaAt,
        arrivedAt: data.arrivedAt,
        notes: data.notes,
        status,
      },
    });

    if (data.purchaseIds?.length) {
      await tx.purchase.updateMany({
        where: { id: { in: data.purchaseIds } },
        data: { shipmentId: shipment.id },
      });
    }

    return tx.shipment.findUniqueOrThrow({ where: { id: shipment.id }, include });
  });

  return serializeShipment(row);
}

export async function updateShipment(
  id: string,
  data: {
    reference?: string;
    departedAt?: Date | null;
    etaAt?: Date | null;
    arrivedAt?: Date | null;
    notes?: string | null;
    status?: ShipmentStatus;
  },
) {
  const existing = await prisma.shipment.findUnique({
    where: { id },
    include: { receptions: true },
  });
  if (!existing) notFound('Envío');

  const departedAt = data.departedAt === undefined ? existing.departedAt : data.departedAt;
  const arrivedAt = data.arrivedAt === undefined ? existing.arrivedAt : data.arrivedAt;
  const status =
    data.status ??
    deriveStatus({
      departedAt,
      arrivedAt,
      hasReception: existing.receptions.length > 0,
    });

  const row = await prisma.shipment.update({
    where: { id },
    data: { ...data, status },
    include,
  });
  return serializeShipment(row);
}

export async function attachPurchase(shipmentId: string, purchaseId: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) notFound('Envío');
  const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) notFound('Compra');
  if (purchase.shipmentId && purchase.shipmentId !== shipmentId) {
    badRequest('La compra ya está asignada a otro envío');
  }
  await prisma.purchase.update({ where: { id: purchaseId }, data: { shipmentId } });
  return getShipment(shipmentId);
}

export function deriveStatus(input: {
  departedAt: Date | null;
  arrivedAt: Date | null;
  hasReception: boolean;
}): ShipmentStatus {
  if (input.hasReception) return ShipmentStatus.RECEPCIONADO;
  if (input.arrivedAt) return ShipmentStatus.LLEGADO;
  if (input.departedAt) return ShipmentStatus.EN_TRANSITO;
  return ShipmentStatus.COORDINADO;
}
