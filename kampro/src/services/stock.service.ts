import { Prisma, StockMovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest } from '../http-error.js';
import { availableQty, netByProduct, qtyNeededBySku, reservationDelta } from '../domain/stock.js';

type Tx = Prisma.TransactionClient;

async function productsBySku(tx: Tx, skus: string[]) {
  const map = new Map<string, { id: string; sku: string; stockQty: number; reservedQty: number }>();
  for (const sku of skus) {
    const product = await tx.product.findUnique({ where: { sku } });
    if (!product) badRequest(`SKU desconocido: ${sku}`);
    map.set(sku, product);
  }
  return map;
}

function reservationNet(movements: Array<{ productId: string; quantity: number; reason: StockMovementReason }>) {
  return netByProduct(movements.filter((m) => m.reason === StockMovementReason.RESERVA));
}

export async function applyOrderReservation(
  tx: Tx,
  orderId: string,
  lines: Array<{ sku: string; quantity: number }>,
): Promise<void> {
  const needed = qtyNeededBySku(lines);
  const movements = await tx.stockMovement.findMany({ where: { orderId } });
  const currentReserved = reservationNet(movements);
  const skuToProduct = await productsBySku(tx, [...needed.keys()]);

  const want = new Map<string, number>();
  for (const [sku, qty] of needed) want.set(skuToProduct.get(sku)!.id, qty);

  const productIds = new Set([...currentReserved.keys(), ...want.keys()]);
  for (const productId of productIds) {
    const delta = reservationDelta(currentReserved.get(productId) ?? 0, want.get(productId) ?? 0);
    if (delta === 0) continue;
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) badRequest('Producto de inventario no encontrado');
    const nextReserved = product.reservedQty + delta;
    if (nextReserved < 0) badRequest(`La reserva de ${product.sku} no puede ser negativa`);
    if (availableQty(product.stockQty, product.reservedQty) - delta < 0 && delta > 0) {
      badRequest(`Stock insuficiente para ${product.sku}: hay ${availableQty(product.stockQty, product.reservedQty)} disponible`);
    }
    await tx.product.update({
      where: { id: productId },
      data: { reservedQty: { increment: delta } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        quantity: delta,
        reason: StockMovementReason.RESERVA,
        orderId,
      },
    });
  }
}

export async function releaseOrderReservation(tx: Tx, orderId: string): Promise<void> {
  const movements = await tx.stockMovement.findMany({ where: { orderId } });
  const reserved = reservationNet(movements);
  for (const [productId, qty] of reserved) {
    if (qty <= 0) continue;
    await tx.product.update({
      where: { id: productId },
      data: { reservedQty: { decrement: qty } },
    });
    await tx.stockMovement.create({
      data: {
        productId,
        quantity: -qty,
        reason: StockMovementReason.RESERVA,
        orderId,
        notes: 'Libera reserva',
      },
    });
  }
}

export async function consumeOrderSale(
  tx: Tx,
  orderId: string,
  lines: Array<{ sku: string; quantity: number }>,
): Promise<Array<{ productId: string; sku: string; quantity: number }>> {
  const needed = qtyNeededBySku(lines);
  const skuToProduct = await productsBySku(tx, [...needed.keys()]);
  const consumed: Array<{ productId: string; sku: string; quantity: number }> = [];
  for (const [sku, qty] of needed) {
    const product = skuToProduct.get(sku)!;
    if (product.stockQty < qty) {
      badRequest(`Stock insuficiente para ${sku}: hay ${product.stockQty}`);
    }
    await tx.product.update({
      where: { id: product.id },
      data: { stockQty: { decrement: qty } },
    });
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        quantity: -qty,
        reason: StockMovementReason.VENTA,
        orderId,
      },
    });
    consumed.push({ productId: product.id, sku, quantity: qty });
  }
  return consumed;
}

export async function restoreOrderSale(
  tx: Tx,
  orderId: string,
  reason: 'CANCELACION_PEDIDO' | 'DEVOLUCION',
): Promise<void> {
  const movements = await tx.stockMovement.findMany({ where: { orderId } });
  const sold = netByProduct(
    movements.filter(
      (m) =>
        m.reason === StockMovementReason.VENTA ||
        m.reason === StockMovementReason.CANCELACION_PEDIDO ||
        m.reason === StockMovementReason.DEVOLUCION,
    ),
  );
  for (const [productId, net] of sold) {
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

export async function migrateOpenOrderReservations(): Promise<void> {
  const open = await prisma.order.findMany({
    where: { status: { notIn: ['CERRADO', 'CANCELADO', 'DEVUELTO'] } },
    include: { stockMovements: true },
  });
  for (const order of open) {
    const sold = netByProduct(order.stockMovements.filter((m) => m.reason === StockMovementReason.VENTA));
    const reserved = reservationNet(order.stockMovements);
    for (const [productId, net] of sold) {
      if (net >= 0) continue;
      const qty = -net;
      if ((reserved.get(productId) ?? 0) >= qty) continue;
      await prisma.product.update({
        where: { id: productId },
        data: { stockQty: { increment: qty }, reservedQty: { increment: qty } },
      });
      await prisma.stockMovement.create({
        data: {
          productId,
          quantity: qty,
          reason: StockMovementReason.VENTA,
          orderId: order.id,
          notes: 'Reversa salida física previa al cierre (migración a reserva)',
        },
      });
      await prisma.stockMovement.create({
        data: {
          productId,
          quantity: qty,
          reason: StockMovementReason.RESERVA,
          orderId: order.id,
          notes: 'Reserva migrada',
        },
      });
    }
  }
}
