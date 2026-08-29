import 'dotenv/config';
import { PrismaClient, PurchaseOrderStatus, StockMovementReason } from '@prisma/client';

const prisma = new PrismaClient();
const demo = process.argv.includes('--demo');

async function main() {
  const products = [
    {
      sku: 'JER-50ML',
      name: 'Jeringa dosificadora de 50 ml',
      capacityMl: 50,
    },
    {
      sku: 'JER-2ML',
      name: 'Jeringa automática de 2 ml',
      capacityMl: 2,
    },
    {
      sku: 'JER-5ML',
      name: 'Jeringa automática de 5 ml',
      capacityMl: 5,
    },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: { name: p.name, capacityMl: p.capacityMl },
      create: p,
    });
  }

  if (!demo) {
    console.log('Seed catálogo OK (3 SKUs, stock 0). Usá --demo para órdenes de compra de ejemplo.');
    return;
  }

  const jer50 = await prisma.product.findUniqueOrThrow({ where: { sku: 'JER-50ML' } });
  const jer2 = await prisma.product.findUniqueOrThrow({ where: { sku: 'JER-2ML' } });
  const jer5 = await prisma.product.findUniqueOrThrow({ where: { sku: 'JER-5ML' } });

  const supplier = await prisma.supplier.upsert({
    where: { id: 'demo-supplier' },
    update: {},
    create: {
      id: 'demo-supplier',
      name: 'Proveedor demo Alibaba',
      contact: 'sales@example.com',
      country: 'CN',
      alibabaUrl: 'https://www.alibaba.com',
      notes: 'Registro de ejemplo para probar el módulo. No es un proveedor real.',
      products: {
        create: [{ productId: jer50.id }, { productId: jer2.id }, { productId: jer5.id }],
      },
    },
  });

  const forwarder = await prisma.forwarder.upsert({
    where: { id: 'demo-forwarder' },
    update: {},
    create: {
      id: 'demo-forwarder',
      name: 'Forwarder demo',
      country: 'CN',
      notes: 'Logística de ejemplo.',
    },
  });

  await prisma.lotConsumption.deleteMany({});
  await prisma.inventoryLot.deleteMany({
    where: { purchaseOrder: { supplierId: supplier.id } },
  });
  await prisma.purchaseOrderInvoice.deleteMany({
    where: { purchaseOrder: { supplierId: supplier.id } },
  });
  await prisma.stockMovement.deleteMany({
    where: { purchaseOrder: { supplierId: supplier.id } },
  });
  await prisma.purchaseOrder.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.product.updateMany({ data: { stockQty: 0, reservedQty: 0, unitCostPyg: null } });

  await prisma.purchaseOrder.create({
    data: {
      status: PurchaseOrderStatus.BORRADOR,
      orderedAt: new Date('2026-08-20'),
      forwarderId: forwarder.id,
      supplierId: supplier.id,
      origin: 'Yiwu, China',
      destination: 'Asunción, Paraguay',
      productId: jer5.id,
      quantity: 50,
      unitPrice: 1.1,
      freight: 30,
      otherCharges: 0,
      fxRateToPyg: 7500,
      comments: 'Borrador: todavía no se pagó al proveedor.',
      lines: {
        create: [{ productId: jer5.id, quantity: 50, unitPrice: 1.1, sortOrder: 0 }],
      },
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      status: PurchaseOrderStatus.CONFIRMADA,
      orderedAt: new Date('2026-07-15'),
      forwarderId: forwarder.id,
      supplierId: supplier.id,
      origin: 'Yiwu, China',
      destination: 'Asunción, Paraguay',
      productId: jer2.id,
      quantity: 200,
      unitPrice: 0.9,
      freight: 80,
      otherCharges: 12,
      fxRateToPyg: 7500,
      comments: 'Pago hecho; en tránsito.',
      paymentReceipt: 'TRX-DEMO-7788',
      confirmedAt: new Date('2026-07-16'),
      lines: {
        create: [{ productId: jer2.id, quantity: 200, unitPrice: 0.9, sortOrder: 0 }],
      },
    },
  });

  const closed = await prisma.purchaseOrder.create({
    data: {
      status: PurchaseOrderStatus.CERRADA,
      orderedAt: new Date('2026-06-20'),
      forwarderId: forwarder.id,
      supplierId: supplier.id,
      origin: 'Yiwu, China',
      destination: 'Asunción, Paraguay',
      productId: jer50.id,
      quantity: 100,
      unitPrice: 2.4,
      freight: 120,
      otherCharges: 15,
      fxRateToPyg: 7500,
      comments: 'Lote recibido y cerrado.',
      paymentReceipt: 'TRX-DEMO-4411',
      confirmedAt: new Date('2026-06-21'),
      receivedAt: new Date('2026-08-12'),
      customsCost: 900000,
      dispatchCost: 350000,
      closedAt: new Date('2026-08-12'),
      lines: {
        create: [{ productId: jer50.id, quantity: 100, unitPrice: 2.4, sortOrder: 0 }],
      },
      invoices: {
        create: [
          {
            invoiceNumber: '001-001-0000101',
            ruc: '80011122-3',
            legalName: 'Despachante Demo SA',
            issuedAt: new Date('2026-08-11'),
            amount: 1250000,
          },
        ],
      },
    },
  });

  await prisma.product.update({
    where: { id: jer50.id },
    data: { stockQty: { increment: 100 } },
  });
  await prisma.stockMovement.create({
    data: {
      productId: jer50.id,
      quantity: 100,
      reason: StockMovementReason.RECEPCION,
      purchaseOrderId: closed.id,
      notes: 'Seed demo: OC cerrada',
    },
  });
  await prisma.inventoryLot.create({
    data: {
      productId: jer50.id,
      purchaseOrderId: closed.id,
      receivedAt: new Date('2026-08-12'),
      qtyOriginal: 100,
      qtyRemaining: 100,
      unitCostPyg: 39489,
    },
  });

  console.log('Seed demo OK: 1 borrador, 1 confirmada, 1 cerrada (stock 50 ml +100).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
