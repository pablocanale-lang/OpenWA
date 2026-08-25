import { prisma } from '../db.js';
import { allocateCosts, totalsByCurrency, type AllocatedPurchase, type CostInput, type PurchaseInput } from '../domain/landed-cost.js';
import { notFound } from '../http-error.js';
import { asString } from '../money.js';

export async function skuCostReport(sku: string) {
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) notFound('Producto');

  const purchases = await prisma.purchase.findMany({
    where: { productId: product.id },
    include: {
      supplier: true,
      product: true,
      receptions: true,
      shipment: {
        include: {
          forwarder: true,
          costs: true,
          purchases: { include: { product: true, supplier: true } },
        },
      },
    },
    orderBy: { purchasedAt: 'desc' },
  });

  const history: Array<AllocatedPurchase & { shipmentId: string | null; forwarderName: string | null }> = [];

  for (const purchase of purchases) {
    const lotPurchases: PurchaseInput[] = purchase.shipment
      ? purchase.shipment.purchases.map((p) => toPurchaseInput(p, purchase.shipment!.reference))
      : [toPurchaseInput(purchase, null)];

    const costs: CostInput[] = (purchase.shipment?.costs ?? []).map((c) => ({
      id: c.id,
      purchaseId: c.purchaseId,
      type: c.type,
      description: c.description,
      amount: asString(c.amount) ?? '0',
      currency: c.currency,
      fxRateToPyg: asString(c.fxRateToPyg),
    }));

    const allocated = allocateCosts(lotPurchases, costs).find((r) => r.purchase.id === purchase.id);
    if (!allocated) continue;

    allocated.qtyReceived = purchase.receptions.reduce((s, r) => s + r.receivedQty, 0);
    history.push({
      ...allocated,
      shipmentId: purchase.shipmentId,
      forwarderName: purchase.shipment?.forwarder.name ?? null,
    });
  }

  const qtyPurchased = purchases.reduce((s, p) => s + p.quantity, 0);
  const qtyReceived = purchases.reduce(
    (s, p) => s + p.receptions.reduce((a, r) => a + r.receivedQty, 0),
    0,
  );

  const pygRows = history.filter((r) => r.landedPyg !== null);
  const pygComplete = history.length > 0 && pygRows.length === history.length;
  const landedPyg = pygComplete ? pygRows.reduce((s, r) => s + (r.landedPyg ?? 0), 0) : null;
  const purchasePyg = pygComplete ? pygRows.reduce((s, r) => s + (r.purchasePyg ?? 0), 0) : null;
  const importPyg = pygComplete ? pygRows.reduce((s, r) => s + (r.importPyg ?? 0), 0) : null;

  return {
    product,
    qtyPurchased,
    qtyReceived,
    stockQty: product.stockQty,
    history,
    totalsByCurrency: totalsByCurrency(history),
    pygEquivalent: pygComplete
      ? {
          purchase: purchasePyg,
          import: importPyg,
          landed: landedPyg,
          unitLanded: qtyPurchased > 0 && landedPyg !== null ? Math.round(landedPyg / qtyPurchased) : null,
        }
      : null,
    note: pygComplete
      ? null
      : 'El total en PYG solo aparece cuando cada compra y cada costo tienen moneda PYG o un tipo de cambio cargado. No se inventa FX.',
  };
}

function toPurchaseInput(
  p: {
    id: string;
    productId: string;
    product: { sku: string };
    quantity: number;
    unitPrice: Parameters<typeof asString>[0];
    total: Parameters<typeof asString>[0];
    currency: string;
    fxRateToPyg: Parameters<typeof asString>[0];
    purchasedAt: Date;
    supplier: { name: string };
  },
  shipmentReference: string | null,
): PurchaseInput {
  return {
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
    shipmentReference,
  };
}
