import { Prisma, PurchaseOrderStatus, StockMovementReason, TreasuryAccount } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { asString, dec } from '../money.js';
import {
  assertCanClose,
  assertCanConfirm,
  assertCanEdit,
  assertCancelRefund,
  assertPurchaseLines,
  chinaCostFromMerchandise,
  completeInvoices,
  merchandiseFromLines,
  normalizePurchaseCurrency,
  openTotalFromMerchandise,
  resolveFxRate,
  spentFromMerchandise,
  stockDeltasOnLinesCancel,
  stockDeltasOnLinesEdit,
  summarizePurchaseOrders,
  totalQuantity,
  type PurchaseOrderInvoiceInput,
  type PurchaseOrderLineInput,
} from '../domain/purchase-orders.js';
import {
  postPurchaseCancelRefund,
  postPurchaseClose,
  postPurchasePay,
  reversePurchaseClose,
  syncPurchaseOrderJournals,
} from './accounting.service.js';
import { removeLotsForPurchaseOrder } from './fifo.service.js';
import { allocateOpNumber } from './operation-numbers.service.js';

const include = {
  forwarder: true,
  supplier: true,
  product: true,
  lines: { include: { product: true }, orderBy: { sortOrder: 'asc' as const } },
  invoices: { orderBy: { issuedAt: 'asc' as const } },
} as const;

type LineRow = {
  productId: string;
  quantity: number;
  unitPrice: unknown;
  product?: { id: string; sku: string; name: string };
};

function parseFx(value: string | undefined): ReturnType<typeof dec> | undefined {
  if (value === undefined || value === '') return undefined;
  const rate = dec(value);
  if (rate.lte(0)) badRequest('El tipo de cambio debe ser mayor a 0');
  return rate;
}

function asLines(items: PurchaseOrderLineInput[] | undefined, fallback?: PurchaseOrderLineInput): PurchaseOrderLineInput[] {
  const lines = items?.length ? items : fallback ? [fallback] : [];
  try {
    assertPurchaseLines(lines);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Líneas inválidas');
  }
  return lines;
}

function linesFromRow(row: {
  productId: string;
  quantity: number;
  unitPrice: unknown;
  lines?: LineRow[];
}): PurchaseOrderLineInput[] {
  if (row.lines?.length) {
    return row.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: asString(line.unitPrice as never) ?? '0',
    }));
  }
  return [{ productId: row.productId, quantity: row.quantity, unitPrice: asString(row.unitPrice as never) ?? '0' }];
}

function serializeInvoice<T extends { amount: unknown }>(row: T) {
  return { ...row, amount: asString(row.amount as never) ?? '0' };
}

function serializePo<
  T extends {
    unitPrice: unknown;
    freight: unknown;
    otherCharges: unknown;
    customsCost: unknown;
    dispatchCost: unknown;
    fxRateToPyg: unknown;
    quantity: number;
    status: PurchaseOrderStatus;
    currency: string;
    productId: string;
    invoices?: Array<{ amount: unknown }>;
    lines?: LineRow[];
    product?: { id: string; sku: string; name: string } | null;
  },
>(row: T) {
  const lines = (row.lines?.length
    ? row.lines
    : [
        {
          productId: row.productId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          product: row.product ?? undefined,
        },
      ]
  ).map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: asString(line.unitPrice as never) ?? '0',
    product: line.product,
  }));
  const unitPrice = lines[0]?.unitPrice ?? (asString(row.unitPrice as never) ?? '0');
  const freight = asString(row.freight as never) ?? '0';
  const otherCharges = asString(row.otherCharges as never) ?? '0';
  const customsCost = asString(row.customsCost as never);
  const dispatchCost = asString(row.dispatchCost as never);
  const fxRateToPyg = asString(row.fxRateToPyg as never);
  const currency = normalizePurchaseCurrency(row.currency);
  const quantity = totalQuantity(lines);
  const merchandise = merchandiseFromLines(lines);
  const open = openTotalFromMerchandise(merchandise, freight, otherCharges);
  const landed = open + Number(customsCost || 0) + Number(dispatchCost || 0);
  const chinaPyg = chinaCostFromMerchandise(merchandise, freight, otherCharges, fxRateToPyg, currency);
  const localPyg = row.status === 'CERRADA' ? Number(customsCost || 0) + Number(dispatchCost || 0) : 0;
  const spent = spentFromMerchandise(
    row.status,
    merchandise,
    freight,
    otherCharges,
    customsCost,
    dispatchCost,
    fxRateToPyg,
    currency,
  );
  const spentPyg =
    row.status === 'BORRADOR' || row.status === 'CANCELADA' || (chinaPyg == null && localPyg === 0) ? null : spent;
  const productNames = lines.map((line) => line.product?.name).filter(Boolean).join(', ');
  return {
    ...row,
    currency,
    unitPrice,
    quantity,
    freight,
    otherCharges,
    customsCost,
    dispatchCost,
    fxRateToPyg: currency === 'PYG' ? null : fxRateToPyg,
    items: lines,
    productName: productNames || row.product?.name || '',
    merchandiseTotal: String(merchandise),
    openTotal: String(open),
    landedTotal: row.status === 'CERRADA' ? String(landed) : String(open),
    chinaPyg: row.status === 'CANCELADA' || chinaPyg == null ? null : String(chinaPyg),
    spentPyg: spentPyg == null ? null : String(spentPyg),
    invoices: (row.invoices ?? []).map(serializeInvoice),
  };
}

async function applyStockDeltas(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  deltas: Array<{ productId: string; quantity: number }>,
  reason: StockMovementReason,
  notes: string,
) {
  for (const delta of deltas) {
    if (delta.quantity === 0) continue;
    const product = await tx.product.findUnique({ where: { id: delta.productId } });
    if (!product) notFound('Producto');
    if (product.stockQty + delta.quantity < 0) {
      badRequest(`El stock no puede quedar negativo (hay ${product.stockQty})`);
    }
    await tx.product.update({
      where: { id: delta.productId },
      data: { stockQty: { increment: delta.quantity } },
    });
    await tx.stockMovement.create({
      data: {
        productId: delta.productId,
        quantity: delta.quantity,
        reason,
        purchaseOrderId,
        notes,
      },
    });
  }
}

async function requireCatalog(data: { productIds: string[]; supplierId: string; forwarderId: string }) {
  const uniqueIds = [...new Set(data.productIds)];
  const [products, supplier, forwarder] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: uniqueIds } } }),
    prisma.supplier.findUnique({ where: { id: data.supplierId } }),
    prisma.forwarder.findUnique({ where: { id: data.forwarderId } }),
  ]);
  if (products.length !== uniqueIds.length) notFound('Producto');
  if (!supplier) notFound('Proveedor');
  if (!forwarder) notFound('Forwarder');
  return { products, supplier, forwarder };
}

async function writeLines(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  supplierId: string,
  lines: PurchaseOrderLineInput[],
) {
  await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId } });
  for (const [index, line] of lines.entries()) {
    await tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: dec(line.unitPrice),
        sortOrder: index,
      },
    });
    await tx.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId, productId: line.productId } },
      create: { supplierId, productId: line.productId },
      update: {},
    });
  }
}

function currencyAndFx(currencyRaw: string | undefined, fxRaw: string | null | undefined) {
  let currency: ReturnType<typeof normalizePurchaseCurrency>;
  try {
    currency = normalizePurchaseCurrency(currencyRaw);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Moneda inválida');
  }
  try {
    const fx = resolveFxRate(currency, fxRaw);
    return { currency, fxRateToPyg: fx == null ? null : parseFx(String(fx)) ?? null };
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Tipo de cambio inválido');
  }
}

export async function listPurchaseOrders() {
  const rows = await prisma.purchaseOrder.findMany({
    include,
    orderBy: { orderedAt: 'desc' },
  });
  return rows.map(serializePo);
}

export async function purchaseOrderSummary() {
  const rows = await prisma.purchaseOrder.findMany({ include: { lines: true } });
  const summary = summarizePurchaseOrders(
    rows.map((row) => {
      const lines = linesFromRow(row);
      return {
        status: row.status,
        quantity: totalQuantity(lines),
        unitPrice: asString(row.unitPrice) ?? '0',
        freight: asString(row.freight),
        otherCharges: asString(row.otherCharges),
        customsCost: asString(row.customsCost),
        dispatchCost: asString(row.dispatchCost),
        fxRateToPyg: asString(row.fxRateToPyg),
        currency: row.currency,
        merchandiseTotal: merchandiseFromLines(lines),
      };
    }),
  );
  return { ...summary, spent: String(summary.spent) };
}

export async function listPurchaseOrderInvoices() {
  const rows = await prisma.purchaseOrderInvoice.findMany({
    include: {
      purchaseOrder: {
        include: { supplier: true, product: true, lines: { include: { product: true } } },
      },
    },
    orderBy: { issuedAt: 'desc' },
  });
  return rows.map((row) => {
    const names = row.purchaseOrder.lines.length
      ? row.purchaseOrder.lines.map((line) => line.product.name).join(', ')
      : row.purchaseOrder.product.name;
    return {
      ...serializeInvoice(row),
      purchaseOrder: {
        id: row.purchaseOrder.id,
        status: row.purchaseOrder.status,
        orderedAt: row.purchaseOrder.orderedAt,
        supplierName: row.purchaseOrder.supplier.name,
        productName: names,
      },
    };
  });
}

export async function listClosedReceptions() {
  const rows = await prisma.purchaseOrder.findMany({
    where: { status: PurchaseOrderStatus.CERRADA },
    include,
    orderBy: { receivedAt: 'desc' },
  });
  return rows.map(serializePo);
}

export async function getPurchaseOrder(id: string) {
  const row = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { ...include, stockMovements: true },
  });
  if (!row) notFound('Orden de compra');
  return serializePo(row);
}

export async function createPurchaseOrder(data: {
  orderedAt: Date;
  forwarderId: string;
  supplierId: string;
  origin: string;
  destination: string;
  productId?: string;
  quantity?: number;
  unitPrice?: string;
  items?: PurchaseOrderLineInput[];
  freight?: string;
  otherCharges?: string;
  fxRateToPyg?: string;
  currency?: string;
  comments?: string;
}) {
  const origin = data.origin.trim();
  const destination = data.destination.trim();
  if (!origin) badRequest('La ubicación de origen es obligatoria');
  if (!destination) badRequest('El destino es obligatorio');
  const lines = asLines(
    data.items,
    data.productId && data.quantity && data.unitPrice
      ? { productId: data.productId, quantity: data.quantity, unitPrice: data.unitPrice }
      : undefined,
  );
  await requireCatalog({ productIds: lines.map((l) => l.productId), supplierId: data.supplierId, forwarderId: data.forwarderId });
  const { currency, fxRateToPyg } = currencyAndFx(data.currency, data.fxRateToPyg);

  const row = await prisma.$transaction(async (tx) => {
    const allocated = await allocateOpNumber(tx, 'purchase-order');
    const created = await tx.purchaseOrder.create({
      data: {
        number: allocated.number,
        numberLabel: allocated.numberLabel,
        orderedAt: data.orderedAt,
        forwarderId: data.forwarderId,
        supplierId: data.supplierId,
        origin,
        destination,
        productId: lines[0].productId,
        quantity: totalQuantity(lines),
        unitPrice: dec(lines[0].unitPrice),
        freight: data.freight ? dec(data.freight) : 0,
        otherCharges: data.otherCharges ? dec(data.otherCharges) : 0,
        fxRateToPyg,
        currency,
        comments: data.comments?.trim() || null,
        status: PurchaseOrderStatus.BORRADOR,
      },
    });
    await writeLines(tx, created.id, data.supplierId, lines);
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include });
  });

  return serializePo(row);
}

export async function updatePurchaseOrder(
  id: string,
  data: {
    orderedAt?: Date;
    forwarderId?: string;
    supplierId?: string;
    origin?: string;
    destination?: string;
    productId?: string;
    quantity?: number;
    unitPrice?: string;
    items?: PurchaseOrderLineInput[];
    freight?: string;
    otherCharges?: string;
    fxRateToPyg?: string | null;
    currency?: string;
    comments?: string | null;
    customsCost?: string;
    dispatchCost?: string;
  },
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) notFound('Orden de compra');
  try {
    assertCanEdit(existing.status);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No se puede editar');
  }
  if (
    (data.customsCost !== undefined || data.dispatchCost !== undefined) &&
    existing.status !== PurchaseOrderStatus.CERRADA
  ) {
    badRequest('Aduana y despacho se cargan al cerrar la OC');
  }

  const prevLines = linesFromRow(existing);
  const nextLines = data.items
    ? asLines(data.items)
    : data.productId || data.quantity !== undefined || data.unitPrice
      ? asLines(undefined, {
          productId: data.productId ?? prevLines[0].productId,
          quantity: data.quantity ?? prevLines[0].quantity,
          unitPrice: data.unitPrice ?? prevLines[0].unitPrice,
        })
      : prevLines;

  const supplierId = data.supplierId ?? existing.supplierId;
  const forwarderId = data.forwarderId ?? existing.forwarderId;
  await requireCatalog({ productIds: nextLines.map((l) => l.productId), supplierId, forwarderId });

  const { currency, fxRateToPyg } =
    data.currency !== undefined || data.fxRateToPyg !== undefined
      ? currencyAndFx(
          data.currency ?? existing.currency,
          data.fxRateToPyg === undefined ? asString(existing.fxRateToPyg) : data.fxRateToPyg,
        )
      : {
          currency: normalizePurchaseCurrency(existing.currency),
          fxRateToPyg:
            existing.fxRateToPyg == null ? null : parseFx(asString(existing.fxRateToPyg) ?? undefined) ?? null,
        };

  const deltas = stockDeltasOnLinesEdit(existing.status, prevLines, nextLines);

  const row = await prisma.$transaction(async (tx) => {
    await applyStockDeltas(tx, id, deltas, StockMovementReason.AJUSTE, `Ajuste por edición de OC ${id.slice(-6)}`);

    await writeLines(tx, id, supplierId, nextLines);

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        orderedAt: data.orderedAt,
        forwarderId: data.forwarderId,
        supplierId: data.supplierId,
        origin: data.origin?.trim(),
        destination: data.destination?.trim(),
        productId: nextLines[0].productId,
        quantity: totalQuantity(nextLines),
        unitPrice: dec(nextLines[0].unitPrice),
        freight: data.freight !== undefined ? dec(data.freight) : undefined,
        otherCharges: data.otherCharges !== undefined ? dec(data.otherCharges) : undefined,
        currency,
        fxRateToPyg: data.currency !== undefined || data.fxRateToPyg !== undefined ? fxRateToPyg : undefined,
        comments: data.comments === undefined ? undefined : data.comments?.trim() || null,
        customsCost: data.customsCost !== undefined ? dec(data.customsCost) : undefined,
        dispatchCost: data.dispatchCost !== undefined ? dec(data.dispatchCost) : undefined,
      },
      include: { lines: true },
    });

    const moneyTouched =
      data.items !== undefined ||
      data.quantity !== undefined ||
      data.unitPrice !== undefined ||
      data.freight !== undefined ||
      data.otherCharges !== undefined ||
      data.fxRateToPyg !== undefined ||
      data.currency !== undefined ||
      data.customsCost !== undefined ||
      data.dispatchCost !== undefined;
    if (moneyTouched) {
      await syncPurchaseOrderJournals(tx, {
        id: updated.id,
        status: updated.status,
        treasury: updated.treasury,
        localTreasury: updated.localTreasury,
        confirmedAt: updated.confirmedAt,
        receivedAt: updated.receivedAt,
        freight: updated.freight,
        otherCharges: updated.otherCharges,
        fxRateToPyg: updated.fxRateToPyg,
        currency: updated.currency,
        customsCost: updated.customsCost,
        dispatchCost: updated.dispatchCost,
        lines: linesFromRow(updated),
      });
    }

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include });
  });
  return serializePo(row);
}

export async function cancelPurchaseOrder(
  id: string,
  refund?: { amountPyg: number; treasury: TreasuryAccount; paidAt: Date; reference?: string | null },
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) notFound('Orden de compra');
  try {
    assertCancelRefund(existing.status, refund ?? null);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No se puede cancelar');
  }

  const deltas = stockDeltasOnLinesCancel(existing.status, linesFromRow(existing));
  const row = await prisma.$transaction(async (tx) => {
    if (existing.status === PurchaseOrderStatus.CERRADA) {
      await removeLotsForPurchaseOrder(tx, id);
      await reversePurchaseClose(tx, id, refund?.paidAt ?? new Date());
    }
    await applyStockDeltas(
      tx,
      id,
      deltas,
      StockMovementReason.CANCELACION_COMPRA,
      `Cancelación de OC ${id.slice(-6)}`,
    );
    if (existing.status !== PurchaseOrderStatus.BORRADOR && refund) {
      await postPurchaseCancelRefund(tx, {
        id,
        amount: Math.round(refund.amountPyg),
        treasury: refund.treasury,
        datedAt: refund.paidAt,
        status: existing.status,
      });
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CANCELADA,
        cancelledAt: new Date(),
        refundAmountPyg: refund ? Math.round(refund.amountPyg) : null,
        refundTreasury: refund?.treasury ?? null,
        refundAt: refund?.paidAt ?? null,
        refundReference: refund?.reference?.trim() || null,
      },
      include,
    });
  });
  return serializePo(row);
}

export async function confirmPurchaseOrder(
  id: string,
  data: { paymentReceipt: string; treasury?: TreasuryAccount; fxRateToPyg?: string | null },
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) notFound('Orden de compra');
  try {
    assertCanConfirm(existing.status, data.paymentReceipt);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No se puede confirmar');
  }

  const treasury = data.treasury ?? TreasuryAccount.BANCO;
  const fx =
    data.fxRateToPyg !== undefined
      ? currencyAndFx(existing.currency, data.fxRateToPyg).fxRateToPyg
      : existing.fxRateToPyg;

  const row = await prisma.$transaction(async (tx) => {
    const confirmed = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CONFIRMADA,
        paymentReceipt: data.paymentReceipt.trim(),
        confirmedAt: new Date(),
        treasury,
        fxRateToPyg: fx ?? undefined,
      },
      include: { lines: true },
    });
    await postPurchasePay(tx, {
      id: confirmed.id,
      quantity: confirmed.quantity,
      unitPrice: confirmed.unitPrice,
      freight: confirmed.freight,
      otherCharges: confirmed.otherCharges,
      fxRateToPyg: confirmed.fxRateToPyg,
      currency: confirmed.currency,
      treasury,
      confirmedAt: confirmed.confirmedAt ?? new Date(),
      lines: linesFromRow(confirmed),
    });
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include });
  });
  return serializePo(row);
}

export async function closePurchaseOrder(
  id: string,
  data: {
    receivedAt: Date;
    customsCost: string;
    dispatchCost: string;
    invoices: PurchaseOrderInvoiceInput[];
    localTreasury?: TreasuryAccount;
  },
) {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) notFound('Orden de compra');
  const invoices = completeInvoices(data.invoices);
  try {
    assertCanClose(existing.status, { ...data, invoices });
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'No se puede cerrar');
  }

  const lines = linesFromRow(existing);
  const merch = merchandiseFromLines(lines);
  const chinaPyg = chinaCostFromMerchandise(
    merch,
    asString(existing.freight),
    asString(existing.otherCharges),
    asString(existing.fxRateToPyg),
    existing.currency,
  );
  const localPyg = Number(data.customsCost) + Number(data.dispatchCost);

  const result = await prisma.$transaction(async (tx) => {
    const closed = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CERRADA,
        receivedAt: data.receivedAt,
        customsCost: dec(data.customsCost),
        dispatchCost: dec(data.dispatchCost),
        localTreasury: data.localTreasury ?? TreasuryAccount.BANCO,
        closedAt: new Date(),
        invoices: {
          create: invoices.map((invoice) => ({
            invoiceNumber: invoice.invoiceNumber.trim(),
            ruc: invoice.ruc.trim(),
            legalName: invoice.legalName.trim(),
            issuedAt: invoice.issuedAt,
            amount: dec(invoice.amount),
          })),
        },
      },
    });

    for (const line of lines) {
      const share = merch > 0 ? merchandiseFromLines([line]) / merch : 0;
      const unitCostPyg =
        chinaPyg != null && line.quantity > 0 ? Math.round((chinaPyg + localPyg) * share / line.quantity) : null;
      await tx.product.update({
        where: { id: line.productId },
        data: {
          stockQty: { increment: line.quantity },
          ...(unitCostPyg != null ? { unitCostPyg } : {}),
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          quantity: line.quantity,
          reason: StockMovementReason.RECEPCION,
          purchaseOrderId: closed.id,
          notes: `Recepción OC cerrada ${closed.id.slice(-6)}`,
        },
      });
    }

    await postPurchaseClose(tx, {
      id: closed.id,
      receivedAt: data.receivedAt,
      customsCost: data.customsCost,
      dispatchCost: data.dispatchCost,
      localTreasury: data.localTreasury ?? TreasuryAccount.BANCO,
      currency: existing.currency,
      freight: existing.freight,
      otherCharges: existing.otherCharges,
      fxRateToPyg: existing.fxRateToPyg,
      lines,
    });

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id: closed.id },
      include,
    });
  });

  return serializePo(result);
}
