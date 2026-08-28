import { Prisma, StockMovementReason } from '@prisma/client';
import { badRequest } from '../http-error.js';
import { netByProduct, qtyNeededBySku, saleDelta } from '../domain/stock.js';

type Tx = Prisma.TransactionClient;

export async function applyOrderStock(
  tx: Tx,
  orderId: string,
  lines: Array<{ sku: string; quantity: number }>,
): Promise<void> {
  const needed = qtyNeededBySku(lines);
  const movements = await tx.stockMovement.findMany({ where: { orderId } });
  const currentNet = netByProduct(movements);

  const skuToProduct = new Map<string, { id: string; sku: string; stockQty: number }>();
  for (const sku of needed.keys()) {
    const product = await tx.product.findUnique({ where: { sku } });
    if (!product) badRequest(`SKU desconocido: ${sku}`);
    skuToProduct.set(sku, product);
  }

  const wantNet = new Map<string, number>();
  for (const [sku, qty] of needed) {
    wantNet.set(skuToProduct.get(sku)!.id, -qty);
  }

  const productIds = new Set([...currentNet.keys(), ...wantNet.keys()]);
  for (const productId of productIds) {
    const delta = saleDelta(currentNet.get(productId) ?? 0, wantNet.has(productId) ? -(wantNet.get(productId) ?? 0) : 0);
    if (delta === 0) continue;

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) badRequest('Producto de inventario no encontrado');
    if (product.stockQty + delta < 0) {
      badRequest(`Stock insuficiente para ${product.sku}: hay ${product.stockQty}`);
    }

    await tx.product.update({
      where: { id: productId },
      data: { stockQty: { increment: delta } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        quantity: delta,
        reason: StockMovementReason.VENTA,
        orderId,
      },
    });
  }
}

export async function restoreOrderStock(
  tx: Tx,
  orderId: string,
  reason: 'CANCELACION_PEDIDO' | 'DEVOLUCION',
): Promise<void> {
  const movements = await tx.stockMovement.findMany({ where: { orderId } });
  const currentNet = netByProduct(movements);

  for (const [productId, net] of currentNet) {
    if (net >= 0) continue;
    const qty = -net;
    await tx.product.update({
      where: { id: productId },
      data: { stockQty: { increment: qty } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        quantity: qty,
        reason:
          reason === 'DEVOLUCION' ? StockMovementReason.DEVOLUCION : StockMovementReason.CANCELACION_PEDIDO,
        orderId,
      },
    });
  }
}
