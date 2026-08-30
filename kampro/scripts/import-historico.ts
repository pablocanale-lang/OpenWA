/**
 * Carga histórica desde el Excel de operaciones.
 * Borra pedidos, OC, asientos y stock operativo (incluidas pruebas) y vuelve a cargar.
 */
import 'dotenv/config';
import {
  CashFlowClass,
  InvoiceSettlement,
  JournalSource,
  OrderStatus,
  OrderZone,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  PurchaseOrderStatus,
  StockMovementReason,
  TreasuryAccount,
} from '@prisma/client';
import { splitIva11 } from '../src/domain/iva.js';
import { quoteTotalPyg } from '../src/domain/order-pricing.js';
import { prisma } from '../src/db.js';
import { dec } from '../src/money.js';
import { ensureSystemAccounts } from '../src/services/accounts.service.js';
import {
  postIvaRetention,
  postOrderClose,
  postOrderPayment,
  postOrderRefund,
  postPurchaseClose,
  postPurchasePay,
} from '../src/services/accounting.service.js';
import { addLot } from '../src/services/fifo.service.js';
import { postEntry } from '../src/services/journal.service.js';
import { consumeOrderSale } from '../src/services/stock.service.js';

const ISSUER = 'Pablo Canale';
const LIST_50 = 640_000;
const WATCH_SKU = 'REL-MOON';

function at(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00-03:00`);
}

function digits(value: string): string {
  return value.replace(/\D/g, '') || '0';
}

type SaleRow = {
  invoiceNumber: string;
  issuedAt: string;
  ruc: string;
  name: string;
  quantity: number;
  unitPricePyg: number;
  city: string;
  carrier: string;
  shippingCostPyg: number;
  shippingAt?: string;
  retention?: { amount: number; certificate: string; datedAt: string };
  payments: Array<{ amount: number; paidAt: string; reference: string; refund?: boolean }>;
};

const SALES: SaleRow[] = [
  {
    invoiceNumber: '001-001-0000452',
    issuedAt: '2026-05-04',
    ruc: '80001622-0',
    name: 'Ganadera Vista Alegre S.A.',
    quantity: 4,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    retention: { amount: 162_909, certificate: '001-001-0011020', datedAt: '2026-05-04' },
    payments: [{ amount: 2_397_091, paidAt: '2026-05-08', reference: '700776812 Ueno' }],
  },
  {
    invoiceNumber: '001-001-0000001',
    issuedAt: '2026-07-01',
    ruc: '1596350-0',
    name: 'Maria de Lourdes Riveros Acevedo',
    quantity: 1,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 640_000, paidAt: '2026-07-01', reference: '10003228046 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000003',
    issuedAt: '2026-07-06',
    ruc: '722866-0',
    name: 'Olga Macarena Valdez',
    quantity: 4,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 2_560_000, paidAt: '2026-07-07', reference: '10003671462 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000004',
    issuedAt: '2026-07-07',
    ruc: '80001622-0',
    name: 'Ganadera Vista Alegre S.A.',
    quantity: 7,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    retention: { amount: 285_091, certificate: '001-001-0011845', datedAt: '2026-07-20' },
    payments: [{ amount: 4_194_909, paidAt: '2026-07-27', reference: '10004932583 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000005',
    issuedAt: '2026-07-31',
    ruc: '700484-3',
    name: 'Joaquin Clavel',
    quantity: 2,
    unitPricePyg: 544_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 1_088_000, paidAt: '2026-08-04', reference: '2438011402 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000006',
    issuedAt: '2026-08-04',
    ruc: '80052876-0',
    name: 'GENPY S.A.',
    quantity: 1,
    unitPricePyg: 544_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 544_000, paidAt: '2026-08-04', reference: '2438011808 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000007',
    issuedAt: '2026-08-04',
    ruc: '342000-3',
    name: 'Beatriz Zavala',
    quantity: 1,
    unitPricePyg: 544_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 544_000, paidAt: '2026-08-04', reference: '2438011844 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000008',
    issuedAt: '2026-08-06',
    ruc: '80088498-1',
    name: 'La Sur Rural S.A.',
    quantity: 1,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 640_000, paidAt: '2026-08-06', reference: '2438186665 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000009',
    issuedAt: '2026-08-14',
    ruc: '3461760-4',
    name: 'Ferdinand Dueck',
    quantity: 1,
    unitPricePyg: 544_000,
    city: 'Lolita, Chaco',
    carrier: 'EMPRESA TRANSPORTE GOLONDRINA S.A.',
    shippingCostPyg: 25_000,
    shippingAt: '2026-08-17',
    payments: [{ amount: 544_000, paidAt: '2026-08-14', reference: '2438743859 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000010',
    issuedAt: '2026-08-14',
    ruc: '876071-3',
    name: 'Fran Duek',
    quantity: 1,
    unitPricePyg: 544_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [{ amount: 544_000, paidAt: '2026-08-14', reference: '2438743859 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000011',
    issuedAt: '2026-08-14',
    ruc: '4209536-0',
    name: 'Jose C Ojeda',
    quantity: 2,
    unitPricePyg: 544_000,
    city: 'Caaguazú',
    carrier: 'TRANSPORTADORA SAN IGNACIO',
    shippingCostPyg: 25_000,
    shippingAt: '2026-08-14',
    payments: [{ amount: 1_088_000, paidAt: '2026-08-14', reference: '2438743859 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000012',
    issuedAt: '2026-08-14',
    ruc: '80001622-0',
    name: 'Ganadera Vista Alegre S.A.',
    quantity: 4,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    retention: { amount: 162_909, certificate: '001-001-0012056', datedAt: '2026-08-17' },
    payments: [{ amount: 2_397_091, paidAt: '2026-08-21', reference: '2439308351 BASA' }],
  },
  {
    invoiceNumber: '001-001-0000013',
    issuedAt: '2026-08-21',
    ruc: '1170421-7',
    name: 'Jose Maria Benitez',
    quantity: 1,
    unitPricePyg: 640_000,
    city: 'No informado',
    carrier: 's/d',
    shippingCostPyg: 0,
    payments: [
      { amount: 700_000, paidAt: '2026-08-21', reference: '2439308351 BASA' },
      { amount: 60_000, paidAt: '2026-08-21', reference: 'Devolución 60.000 FC 001-001-0000013', refund: true },
    ],
  },
];

const PURCHASES = [
  {
    key: 'oc-4',
    datedAt: '2026-03-30',
    quantity: 4,
    merchandise: 780_360,
    freight: 289_000,
    comments: 'Carga histórica asiento 4. Costo de FC 001-001-0000452. Sin comprobante bancario ni factura de proveedor.',
  },
  {
    key: 'oc-6',
    datedAt: '2026-05-13',
    quantity: 12,
    merchandise: 1_772_957,
    freight: 818_400,
    comments: 'Carga histórica asiento 6. Costo de FC 001-001-0000001, 0000003 y 0000004. Sin comprobante bancario ni factura de proveedor.',
  },
  {
    key: 'oc-7',
    datedAt: '2026-07-08',
    quantity: 21,
    merchandise: 2_118_449,
    freight: 2_214_900,
    comments: 'Carga histórica asiento 7 (21 unidades). Costo de FC 001-001-0000005 a 0000013. Sin comprobante bancario ni factura de proveedor.',
  },
] as const;

async function wipeOperations() {
  await prisma.lotConsumption.deleteMany();
  await prisma.inventoryLot.deleteMany();
  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.purchaseOrderInvoice.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.receptionIncident.deleteMany();
  await prisma.reception.deleteMany();
  await prisma.importCost.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.order.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.journalSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: 1 },
    update: { nextNumber: 1 },
  });
  await prisma.invoiceSequence.upsert({
    where: { id: 'default' },
    create: { id: 'default', nextNumber: 14, issuer: ISSUER },
    update: { nextNumber: 14, issuer: ISSUER },
  });
  await prisma.product.updateMany({ data: { stockQty: 0, reservedQty: 0, unitCostPyg: null } });
  await prisma.product.deleteMany({ where: { sku: 'TEST-INV' } });
  await prisma.supplier.deleteMany({
    where: { name: { not: 'Hefei Taimusi Network Technology Co., Ltd.' } },
  });
  await prisma.forwarder.deleteMany();
}

async function ensureCatalog() {
  const jer50 = await prisma.product.upsert({
    where: { sku: 'JER-50ML' },
    update: { name: 'Jeringa dosificadora de 50 ml', capacityMl: 50, unitPricePyg: LIST_50, status: ProductStatus.ACTIVE },
    create: {
      sku: 'JER-50ML',
      name: 'Jeringa dosificadora de 50 ml',
      capacityMl: 50,
      unitPricePyg: LIST_50,
    },
  });
  await prisma.product.upsert({
    where: { sku: 'JER-2ML' },
    update: { unitPricePyg: 300_000, status: ProductStatus.ACTIVE },
    create: { sku: 'JER-2ML', name: 'Jeringa automática de 2 ml', capacityMl: 2, unitPricePyg: 300_000 },
  });
  await prisma.product.upsert({
    where: { sku: 'JER-5ML' },
    update: { unitPricePyg: 300_000, status: ProductStatus.ACTIVE },
    create: { sku: 'JER-5ML', name: 'Jeringa automática de 5 ml', capacityMl: 5, unitPricePyg: 300_000 },
  });
  const watch = await prisma.product.upsert({
    where: { sku: WATCH_SKU },
    update: {
      name: 'Reloj MoonSwatch (histórico)',
      capacityMl: 1,
      unitPricePyg: 750_000,
      status: ProductStatus.INACTIVE,
      stockQty: 0,
      reservedQty: 0,
      unitCostPyg: null,
    },
    create: {
      sku: WATCH_SKU,
      name: 'Reloj MoonSwatch (histórico)',
      capacityMl: 1,
      unitPricePyg: 750_000,
      status: ProductStatus.INACTIVE,
    },
  });
  const hefeiName = 'Hefei Taimusi Network Technology Co., Ltd.';
  const hefeiData = {
    name: hefeiName,
    country: 'CN',
    alibabaUrl:
      'https://www.alibaba.com/product-detail/25-50ml-Chicken-Duck-Goose-Semi_1600928547915.html?spm=a2756.trade-list-buyer.0.0.6fc776e9RANiY8',
    notes: 'Proveedor de las compras históricas de dosificadores.',
  };
  const existingSupplier = await prisma.supplier.findFirst({ where: { name: hefeiName } });
  const supplier = existingSupplier
    ? await prisma.supplier.update({ where: { id: existingSupplier.id }, data: hefeiData })
    : await prisma.supplier.create({ data: { id: 'hefei-taimusi', ...hefeiData } });
  await prisma.supplierProduct.upsert({
    where: { supplierId_productId: { supplierId: supplier.id, productId: jer50.id } },
    create: { supplierId: supplier.id, productId: jer50.id },
    update: {},
  });
  const forwarder = await prisma.forwarder.create({
    data: { name: 'Frontliner', country: 'CN', notes: 'Forwarder de las importaciones históricas.' },
  });
  return { jer50, watch, supplier, forwarder };
}

async function postCapital(tx: Parameters<typeof postEntry>[0]) {
  const datedAt = at('2025-12-10');
  await postEntry(tx, {
    datedAt,
    memo: 'Aporte de capital socios (Elias Pei y Pablo Canale, 216.337 c/u)',
    sourceType: JournalSource.OPENING,
    sourceId: 'historico-capital',
    event: 'CAPITAL',
    cashFlow: CashFlowClass.FINANCING,
    skipIfExists: false,
    lines: [
      { role: 'BANCO', debit: 432_674, credit: 0, memo: 'Aporte de capital socios' },
      { role: 'CAPITAL', debit: 0, credit: 432_674, memo: 'Aporte de capital socios' },
    ],
  });
}

async function buyWatches(tx: Parameters<typeof postEntry>[0], productId: string) {
  const datedAt = at('2025-12-10');
  await tx.product.update({ where: { id: productId }, data: { stockQty: { increment: 2 }, unitCostPyg: 216_337 } });
  await tx.stockMovement.create({
    data: {
      productId,
      quantity: 2,
      reason: StockMovementReason.RECEPCION,
      notes: 'Carga histórica asiento 2: compra 2 MoonSwatch',
    },
  });
  await addLot(tx, {
    productId,
    receivedAt: datedAt,
    quantity: 2,
    unitCostPyg: 216_337,
  });
  await postEntry(tx, {
    datedAt,
    memo: 'Compra de relojes MoonSwatch (2 unidades)',
    sourceType: JournalSource.MANUAL,
    sourceId: 'historico-moonswatch-compra',
    event: 'MANUAL',
    skipIfExists: false,
    lines: [
      { role: 'INVENTARIO', debit: 432_674, credit: 0, productId, quantity: 2 },
      { role: 'BANCO', debit: 0, credit: 432_674 },
    ],
  });
}

async function closeWatchSale(tx: Parameters<typeof postEntry>[0], sku: string, name: string) {
  const datedAt = at('2026-03-30');
  const items = [
    { sku, productName: name, quantity: 1, unitPricePyg: 750_000, discountApplied: 0, lineTotal: 750_000, sortOrder: 0 },
    { sku, productName: name, quantity: 1, unitPricePyg: 700_000, discountApplied: 0, lineTotal: 700_000, sortOrder: 1 },
  ];
  const order = await tx.order.create({
    data: {
      sku,
      productName: `${name} ×2`,
      quantity: 2,
      discountApplied: 0,
      totalAmount: 1_450_000,
      zone: OrderZone.INTERIOR,
      customerPhone: '0',
      contactName: 'Venta histórica MoonSwatch',
      recipientName: 'Venta histórica MoonSwatch',
      invoiceName: 'Venta histórica MoonSwatch',
      ruc: '0',
      invoiceSettlement: InvoiceSettlement.CONTADO,
      status: OrderStatus.CERRADO,
      city: 'No informado',
      carrier: 's/d',
      shippingCostPyg: 0,
      createdAt: datedAt,
      items: { create: items },
    },
  });
  const payment = await tx.payment.create({
    data: {
      orderId: order.id,
      amount: 1_450_000,
      method: PaymentMethod.TRANSFERENCIA,
      paidAt: datedAt,
      status: PaymentStatus.CONFIRMADO,
      reference: 'Carga histórica asiento 3',
    },
  });
  await postOrderPayment(tx, {
    orderId: order.id,
    paymentId: payment.id,
    amount: payment.amount,
    method: payment.method,
    paidAt: payment.paidAt,
    orderClosed: true,
    settlement: InvoiceSettlement.CONTADO,
  });
  const consumed = await consumeOrderSale(tx, order.id, items);
  await postOrderClose(tx, {
    orderId: order.id,
    datedAt,
    gross: 1_450_000,
    prepaid: 1_450_000,
    settlement: InvoiceSettlement.CONTADO,
    invoiceNumber: null,
    lines: consumed,
  });
}

async function closeSyringePo(
  tx: Parameters<typeof postEntry>[0],
  input: {
    productId: string;
    supplierId: string;
    forwarderId: string;
    datedAt: Date;
    quantity: number;
    merchandise: number;
    freight: number;
    comments: string;
  },
) {
  const unitPrice = input.merchandise / input.quantity;
  const po = await tx.purchaseOrder.create({
    data: {
      status: PurchaseOrderStatus.CERRADA,
      orderedAt: input.datedAt,
      confirmedAt: input.datedAt,
      receivedAt: input.datedAt,
      closedAt: input.datedAt,
      forwarderId: input.forwarderId,
      supplierId: input.supplierId,
      origin: 'China',
      destination: 'Asunción, Paraguay',
      productId: input.productId,
      quantity: input.quantity,
      unitPrice: dec(unitPrice),
      freight: dec(input.freight),
      otherCharges: dec(0),
      currency: 'PYG',
      fxRateToPyg: null,
      comments: input.comments,
      paymentReceipt: 's/d',
      treasury: TreasuryAccount.BANCO,
      localTreasury: TreasuryAccount.BANCO,
      customsCost: dec(0),
      dispatchCost: dec(0),
      lines: {
        create: [{ productId: input.productId, quantity: input.quantity, unitPrice: dec(unitPrice), sortOrder: 0 }],
      },
    },
    include: { lines: true },
  });
  await tx.product.update({
    where: { id: input.productId },
    data: { stockQty: { increment: input.quantity } },
  });
  await tx.stockMovement.create({
    data: {
      productId: input.productId,
      quantity: input.quantity,
      reason: StockMovementReason.RECEPCION,
      purchaseOrderId: po.id,
      notes: `Recepción histórica OC ${po.id.slice(-6)}`,
    },
  });
  const lines = po.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
  await postPurchasePay(tx, {
    id: po.id,
    quantity: po.quantity,
    unitPrice: po.unitPrice,
    freight: po.freight,
    otherCharges: po.otherCharges,
    fxRateToPyg: po.fxRateToPyg,
    currency: po.currency,
    treasury: 'BANCO',
    confirmedAt: input.datedAt,
    lines,
  });
  await postPurchaseClose(tx, {
    id: po.id,
    receivedAt: input.datedAt,
    customsCost: 0,
    dispatchCost: 0,
    localTreasury: 'BANCO',
    currency: po.currency,
    freight: po.freight,
    otherCharges: po.otherCharges,
    fxRateToPyg: po.fxRateToPyg,
    lines,
  });
  return po;
}

async function closeSyringeSale(
  tx: Parameters<typeof postEntry>[0],
  product: { id: string; sku: string; name: string },
  row: SaleRow,
) {
  const discountApplied = row.unitPricePyg === 544_000 ? 15 : 0;
  const lineTotal = quoteTotalPyg(LIST_50, row.quantity, discountApplied);
  if (lineTotal !== row.unitPricePyg * row.quantity) {
    throw new Error(`Total inconsistente ${row.invoiceNumber}: ${lineTotal} vs ${row.unitPricePyg * row.quantity}`);
  }
  const issuedAt = at(row.issuedAt);
  const order = await tx.order.create({
    data: {
      sku: product.sku,
      productName: `${product.name} ×${row.quantity}`,
      quantity: row.quantity,
      discountApplied,
      totalAmount: lineTotal,
      zone: OrderZone.INTERIOR,
      customerPhone: digits(row.ruc),
      contactName: row.name,
      recipientName: row.name,
      invoiceName: row.name,
      ruc: row.ruc,
      invoiceSettlement: InvoiceSettlement.CONTADO,
      status: OrderStatus.CERRADO,
      city: row.city,
      carrier: row.carrier,
      shippingCostPyg: row.shippingCostPyg,
      invoiceNumber: row.invoiceNumber,
      invoiceIssuer: ISSUER,
      invoiceIssuedAt: issuedAt,
      createdAt: issuedAt,
      items: {
        create: [
          {
            sku: product.sku,
            productName: product.name,
            quantity: row.quantity,
            unitPricePyg: LIST_50,
            discountApplied,
            lineTotal,
            sortOrder: 0,
          },
        ],
      },
    },
  });

  let prepaid = 0;
  for (const pay of row.payments) {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        amount: pay.amount,
        method: PaymentMethod.TRANSFERENCIA,
        paidAt: at(pay.paidAt),
        status: pay.refund ? PaymentStatus.REEMBOLSADO : PaymentStatus.CONFIRMADO,
        reference: pay.reference,
      },
    });
    if (pay.refund) {
      await postOrderRefund(tx, {
        orderId: order.id,
        paymentId: payment.id,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt,
      });
      prepaid -= payment.amount;
    } else {
      await postOrderPayment(tx, {
        orderId: order.id,
        paymentId: payment.id,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt,
        orderClosed: false,
        settlement: InvoiceSettlement.CONTADO,
      });
      prepaid += payment.amount;
    }
  }

  if (row.retention) {
    await postIvaRetention(tx, {
      orderId: order.id,
      amount: row.retention.amount,
      datedAt: at(row.retention.datedAt),
      certificate: row.retention.certificate,
    });
    prepaid += row.retention.amount;
  }

  const consumed = await consumeOrderSale(tx, order.id, [{ sku: product.sku, quantity: row.quantity }]);
  await postOrderClose(tx, {
    orderId: order.id,
    datedAt: issuedAt,
    gross: lineTotal,
    prepaid,
    settlement: InvoiceSettlement.CONTADO,
    invoiceNumber: row.invoiceNumber,
    lines: consumed,
  });

  if (row.shippingCostPyg > 0) {
    const shipAt = at(row.shippingAt ?? row.issuedAt);
    const split = splitIva11(row.shippingCostPyg);
    await postEntry(tx, {
      datedAt: shipAt,
      memo: `Flete venta ${row.invoiceNumber}`,
      sourceType: JournalSource.ORDER,
      sourceId: order.id,
      event: 'SHIPPING',
      skipIfExists: false,
      lines: [
        { role: 'FLETE_VENTAS', debit: split.net, credit: 0, memo: `Flete venta ${row.invoiceNumber}` },
        { role: 'IVA_CREDITO', debit: split.iva, credit: 0, memo: `Flete venta ${row.invoiceNumber}` },
        { role: 'BANCO', debit: 0, credit: row.shippingCostPyg, memo: `Flete venta ${row.invoiceNumber}` },
      ],
    });
  }

  return order;
}

async function report() {
  const products = await prisma.product.findMany({
    include: { inventoryLots: true },
    orderBy: { sku: 'asc' },
  });
  const orders = await prisma.order.findMany({ include: { payments: true } });
  const entries = await prisma.journalEntry.findMany({
    include: { lines: { include: { account: true } } },
    orderBy: { number: 'asc' },
  });
  const balances = new Map<string, { name: string; debit: number; credit: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const row = balances.get(line.account.code) ?? { name: line.account.name, debit: 0, credit: 0 };
      row.debit += line.debit;
      row.credit += line.credit;
      balances.set(line.account.code, row);
    }
  }
  console.log('\n=== Stock ===');
  for (const product of products) {
    const lotQty = product.inventoryLots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
    console.log(
      `${product.sku} físico=${product.stockQty} reservado=${product.reservedQty} lotes=${lotQty} costoUd=${product.unitCostPyg ?? '—'}`,
    );
  }
  console.log(`\n=== Pedidos ${orders.length} · asientos ${entries.length} ===`);
  for (const order of orders) {
    console.log(`${order.invoiceNumber ?? 's/FC'} ${order.status} ${order.customerPhone} ${order.totalAmount}`);
  }
  console.log('\n=== Saldos ===');
  for (const [code, row] of [...balances.entries()].sort()) {
    const net = row.debit - row.credit;
    if (net === 0) continue;
    console.log(`${code} ${row.name}  ${net}`);
  }
  const last = entries.at(-1);
  console.log(`\nÚltimo asiento ${last?.numberLabel ?? '—'} · próxima factura 001-001-0000014`);
}

async function main() {
  await ensureSystemAccounts();
  console.log('Limpiando datos de prueba y operaciones previas…');
  await wipeOperations();
  const catalog = await ensureCatalog();

  await prisma.$transaction(async (tx) => {
    await postCapital(tx);
    await buyWatches(tx, catalog.watch.id);
    await closeWatchSale(tx, catalog.watch.sku, catalog.watch.name);
    for (const purchase of PURCHASES) {
      await closeSyringePo(tx, {
        productId: catalog.jer50.id,
        supplierId: catalog.supplier.id,
        forwarderId: catalog.forwarder.id,
        datedAt: at(purchase.datedAt),
        quantity: purchase.quantity,
        merchandise: purchase.merchandise,
        freight: purchase.freight,
        comments: purchase.comments,
      });
    }
    for (const sale of SALES) {
      await closeSyringeSale(tx, catalog.jer50, sale);
    }
  });

  await report();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
