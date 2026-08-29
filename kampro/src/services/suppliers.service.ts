import { prisma } from '../db.js';
import { notFound } from '../http-error.js';

export async function listSuppliers() {
  return prisma.supplier.findMany({
    include: {
      products: { include: { product: true } },
      _count: { select: { purchases: true, purchaseOrders: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      products: { include: { product: true } },
      purchases: {
        include: { product: true, shipment: true },
        orderBy: { purchasedAt: 'desc' },
      },
    },
  });
  if (!supplier) notFound('Proveedor');
  return supplier;
}

export async function createSupplier(data: {
  name: string;
  contact?: string;
  country?: string;
  alibabaUrl?: string;
  notes?: string;
  productIds?: string[];
}) {
  const { productIds, ...rest } = data;
  return prisma.supplier.create({
    data: {
      ...rest,
      products: productIds?.length
        ? { create: productIds.map((productId) => ({ productId })) }
        : undefined,
    },
    include: { products: { include: { product: true } } },
  });
}

export async function updateSupplier(
  id: string,
  data: {
    name?: string;
    contact?: string | null;
    country?: string;
    alibabaUrl?: string | null;
    notes?: string | null;
  },
) {
  await getSupplier(id);
  return prisma.supplier.update({
    where: { id },
    data,
    include: { products: { include: { product: true } } },
  });
}

export async function linkSupplierProduct(supplierId: string, productId: string) {
  await getSupplier(supplierId);
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound('Producto');
  return prisma.supplierProduct.upsert({
    where: { supplierId_productId: { supplierId, productId } },
    create: { supplierId, productId },
    update: {},
  });
}

export async function unlinkSupplierProduct(supplierId: string, productId: string) {
  await prisma.supplierProduct.delete({
    where: { supplierId_productId: { supplierId, productId } },
  });
}
