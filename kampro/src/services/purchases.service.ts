import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { asString, dec, decMul } from '../money.js';

function serializePurchase<T extends { unitPrice: unknown; total: unknown; fxRateToPyg: unknown }>(row: T) {
  return {
    ...row,
    unitPrice: asString(row.unitPrice as never),
    total: asString(row.total as never),
    fxRateToPyg: asString(row.fxRateToPyg as never),
  };
}

const include = {
  product: true,
  supplier: true,
  shipment: { include: { forwarder: true } },
  receptions: true,
} as const;

export async function listPurchases() {
  const rows = await prisma.purchase.findMany({
    include,
    orderBy: { purchasedAt: 'desc' },
  });
  return rows.map(serializePurchase);
}

export async function getPurchase(id: string) {
  const row = await prisma.purchase.findUnique({
    where: { id },
    include: {
      ...include,
      costs: true,
    },
  });
  if (!row) notFound('Compra');
  return serializePurchase(row);
}

export async function createPurchase(data: {
  purchasedAt: Date;
  productId: string;
  supplierId: string;
  shipmentId?: string;
  quantity: number;
  unitPrice: string;
  currency?: string;
  fxRateToPyg?: string;
  notes?: string;
}) {
  if (data.quantity <= 0) badRequest('La cantidad debe ser mayor a 0');

  const [product, supplier] = await Promise.all([
    prisma.product.findUnique({ where: { id: data.productId } }),
    prisma.supplier.findUnique({ where: { id: data.supplierId } }),
  ]);
  if (!product) notFound('Producto');
  if (!supplier) notFound('Proveedor');

  if (data.shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } });
    if (!shipment) notFound('Envío');
  }

  const unitPrice = dec(data.unitPrice);
  const total = decMul(unitPrice, data.quantity);

  const row = await prisma.purchase.create({
    data: {
      purchasedAt: data.purchasedAt,
      productId: data.productId,
      supplierId: data.supplierId,
      shipmentId: data.shipmentId,
      quantity: data.quantity,
      unitPrice,
      total,
      currency: data.currency ?? 'USD',
      fxRateToPyg: data.fxRateToPyg ? dec(data.fxRateToPyg) : undefined,
      notes: data.notes,
    },
    include,
  });

  await prisma.supplierProduct.upsert({
    where: { supplierId_productId: { supplierId: data.supplierId, productId: data.productId } },
    create: { supplierId: data.supplierId, productId: data.productId },
    update: {},
  });

  return serializePurchase(row);
}

export async function updatePurchase(
  id: string,
  data: {
    purchasedAt?: Date;
    shipmentId?: string | null;
    quantity?: number;
    unitPrice?: string;
    currency?: string;
    fxRateToPyg?: string | null;
    notes?: string | null;
  },
) {
  const existing = await prisma.purchase.findUnique({
    where: { id },
    include: { receptions: true },
  });
  if (!existing) notFound('Compra');
  if (existing.receptions.length && (data.quantity !== undefined || data.unitPrice !== undefined)) {
    badRequest('No se puede cambiar cantidad o precio de una compra ya recepcionada');
  }

  if (data.shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: data.shipmentId } });
    if (!shipment) notFound('Envío');
  }

  const quantity = data.quantity ?? existing.quantity;
  const unitPrice = data.unitPrice !== undefined ? dec(data.unitPrice) : existing.unitPrice;
  const total = decMul(unitPrice, quantity);

  const row = await prisma.purchase.update({
    where: { id },
    data: {
      purchasedAt: data.purchasedAt,
      shipmentId: data.shipmentId,
      quantity: data.quantity,
      unitPrice: data.unitPrice !== undefined ? unitPrice : undefined,
      total,
      currency: data.currency,
      fxRateToPyg: data.fxRateToPyg === null ? null : data.fxRateToPyg ? dec(data.fxRateToPyg) : undefined,
      notes: data.notes,
    },
    include,
  });
  return serializePurchase(row);
}
