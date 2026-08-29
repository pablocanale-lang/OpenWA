import { ProductStatus, StockMovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { availableQty } from '../domain/stock.js';
import { addLot, consumeAdjustment } from './fifo.service.js';
import { postStockAdjustJournal } from './accounting.service.js';

const SKU_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function presentProduct<T extends { stockQty: number; reservedQty: number }>(product: T) {
  return { ...product, availableQty: availableQty(product.stockQty, product.reservedQty) };
}

export async function listProducts() {
  const rows = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
  return rows.map(presentProduct);
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { suppliers: { include: { supplier: true } } },
  });
  if (!product) notFound('Producto');
  return presentProduct(product);
}

export async function getProductBySku(sku: string) {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: { suppliers: { include: { supplier: true } } },
  });
  if (!product) notFound('Producto');
  return presentProduct(product);
}

export async function listStockMovements(productId: string) {
  await getProduct(productId);
  return prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function createProduct(data: {
  sku: string;
  name: string;
  capacityMl: number;
  unitPricePyg: number;
  stockQty?: number;
}) {
  const sku = data.sku.trim().toUpperCase();
  if (!SKU_RE.test(sku)) badRequest('SKU inválido. Usá letras, números y guiones (ej. JER-10ML)');
  const name = data.name.trim();
  if (!name) badRequest('El nombre es obligatorio');
  if (!Number.isInteger(data.capacityMl) || data.capacityMl < 1) badRequest('La capacidad debe ser al menos 1 ml');
  if (!Number.isInteger(data.unitPricePyg) || data.unitPricePyg < 1) {
    badRequest('El precio de venta es obligatorio');
  }
  const stockQty = data.stockQty ?? 0;
  if (!Number.isInteger(stockQty) || stockQty < 0) badRequest('El stock no puede ser negativo');

  const exists = await prisma.product.findUnique({ where: { sku } });
  if (exists) badRequest(`El SKU ${sku} ya existe`);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sku,
        name,
        capacityMl: data.capacityMl,
        unitPricePyg: data.unitPricePyg,
        stockQty,
        status: ProductStatus.ACTIVE,
      },
    });
    if (stockQty > 0) {
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          quantity: stockQty,
          reason: StockMovementReason.AJUSTE,
          notes: 'Stock inicial',
        },
      });
      await addLot(tx, {
        productId: product.id,
        receivedAt: new Date(),
        quantity: stockQty,
        unitCostPyg: 0,
      });
    }
    return presentProduct(product);
  });
}

export async function updateProduct(
  id: string,
  data: {
    name?: string;
    capacityMl?: number;
    unitPricePyg?: number | null;
    status?: ProductStatus;
  },
) {
  await getProduct(id);
  if (data.unitPricePyg !== undefined && data.unitPricePyg !== null && data.unitPricePyg < 1) {
    badRequest('El precio de venta debe ser mayor a 0');
  }
  const updated = await prisma.product.update({
    where: { id },
    data: {
      name: data.name?.trim(),
      capacityMl: data.capacityMl,
      unitPricePyg: data.unitPricePyg,
      status: data.status,
    },
  });
  return presentProduct(updated);
}

export async function adjustStock(id: string, delta: number, notes?: string | null) {
  if (!Number.isInteger(delta) || delta === 0) badRequest('El ajuste de stock no puede ser 0');
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) notFound('Producto');
    if (product.stockQty + delta < 0) badRequest(`El stock no puede quedar negativo (hay ${product.stockQty})`);
    if (availableQty(product.stockQty, product.reservedQty) + delta < 0 && delta < 0) {
      badRequest(`No hay disponible suficiente para ajustar ${product.sku}`);
    }
    const updated = await tx.product.update({
      where: { id },
      data: { stockQty: { increment: delta } },
    });
    const movement = await tx.stockMovement.create({
      data: {
        productId: id,
        quantity: delta,
        reason: StockMovementReason.AJUSTE,
        notes: notes?.trim() || null,
      },
    });
    if (delta > 0) {
      await addLot(tx, {
        productId: id,
        receivedAt: new Date(),
        quantity: delta,
        unitCostPyg: product.unitCostPyg ?? 0,
      });
      await postStockAdjustJournal(tx, {
        productId: id,
        movementId: movement.id,
        costPyg: delta * (product.unitCostPyg ?? 0),
        increase: true,
        datedAt: new Date(),
        quantity: delta,
      });
    } else {
      const qty = -delta;
      const consumed = await consumeAdjustment(tx, id, qty);
      await postStockAdjustJournal(tx, {
        productId: id,
        movementId: movement.id,
        costPyg: consumed.totalCostPyg,
        increase: false,
        datedAt: new Date(),
        quantity: qty,
      });
    }
    return presentProduct(updated);
  });
}
