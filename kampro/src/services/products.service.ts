import { ProductStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { notFound } from '../http-error.js';

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
  return prisma.product.update({ where: { id }, data });
}
