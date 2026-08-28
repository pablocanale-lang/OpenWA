import { ProductStatus, StockMovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';

const SKU_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { sku: 'asc' } });
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { suppliers: { include: { supplier: true } } },
  });
  if (!product) notFound('Producto');
  return product;
}

export async function getProductBySku(sku: string) {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: { suppliers: { include: { supplier: true } } },
  });
  if (!product) notFound('Producto');
  return product;
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
    }
    return product;
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
  return prisma.product.update({
    where: { id },
    data: {
      name: data.name?.trim(),
      capacityMl: data.capacityMl,
      unitPricePyg: data.unitPricePyg,
      status: data.status,
    },
  });
}

export async function adjustStock(id: string, delta: number, notes?: string | null) {
  if (!Number.isInteger(delta) || delta === 0) badRequest('El ajuste de stock no puede ser 0');
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) notFound('Producto');
    if (product.stockQty + delta < 0) badRequest(`El stock no puede quedar negativo (hay ${product.stockQty})`);
    const updated = await tx.product.update({
      where: { id },
      data: { stockQty: { increment: delta } },
    });
    await tx.stockMovement.create({
      data: {
        productId: id,
        quantity: delta,
        reason: StockMovementReason.AJUSTE,
        notes: notes?.trim() || null,
      },
    });
    return updated;
  });
}
