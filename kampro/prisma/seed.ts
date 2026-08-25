import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

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
    console.log('Seed catálogo OK (3 SKUs, stock 0). Usá --demo para un lote de importación de ejemplo.');
    return;
  }

  const jer50 = await prisma.product.findUniqueOrThrow({ where: { sku: 'JER-50ML' } });
  const jer2 = await prisma.product.findUniqueOrThrow({ where: { sku: 'JER-2ML' } });

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
        create: [{ productId: jer50.id }, { productId: jer2.id }],
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

  await prisma.receptionIncident.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.reception.deleteMany();
  await prisma.importCost.deleteMany();
  await prisma.purchase.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.shipment.deleteMany({ where: { forwarderId: forwarder.id } });
  await prisma.product.updateMany({ data: { stockQty: 0, unitCostPyg: null } });

  const shipment = await prisma.shipment.create({
    data: {
      forwarderId: forwarder.id,
      reference: 'DEMO-FWD-001',
      departedAt: new Date('2026-07-01'),
      etaAt: new Date('2026-08-10'),
      arrivedAt: new Date('2026-08-12'),
      status: 'LLEGADO',
    },
  });

  const p50 = await prisma.purchase.create({
    data: {
      purchasedAt: new Date('2026-06-20'),
      productId: jer50.id,
      supplierId: supplier.id,
      shipmentId: shipment.id,
      quantity: 100,
      unitPrice: 2.4,
      total: 240,
      currency: 'USD',
      fxRateToPyg: 7500,
    },
  });

  await prisma.purchase.create({
    data: {
      purchasedAt: new Date('2026-06-20'),
      productId: jer2.id,
      supplierId: supplier.id,
      shipmentId: shipment.id,
      quantity: 200,
      unitPrice: 0.9,
      total: 180,
      currency: 'USD',
      fxRateToPyg: 7500,
    },
  });

  await prisma.importCost.createMany({
    data: [
      {
        shipmentId: shipment.id,
        type: 'LOGISTICA',
        description: 'Flete forwarder',
        amount: 120,
        currency: 'USD',
        fxRateToPyg: 7500,
      },
      {
        shipmentId: shipment.id,
        type: 'ADUANA',
        description: 'Tasas aduaneras',
        amount: 900000,
        currency: 'PYG',
      },
      {
        shipmentId: shipment.id,
        purchaseId: p50.id,
        type: 'OTRO',
        description: 'Inspección extra 50 ml',
        amount: 15,
        currency: 'USD',
        fxRateToPyg: 7500,
      },
    ],
  });

  console.log('Seed demo OK: proveedor + envío + costos. Registrá la recepción desde la UI para impactar stock.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
