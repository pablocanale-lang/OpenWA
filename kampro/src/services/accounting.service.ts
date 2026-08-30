import {
  InvoiceSettlement,
  JournalSource,
  OrderStatus,
  PaymentMethod,
  PurchaseOrderStatus,
  type Prisma,
} from '@prisma/client';
import { chinaCostFromMerchandise, merchandiseFromLines } from '../domain/purchase-orders.js';
import { asString } from '../money.js';
import {
  linesCogs,
  linesCreditCollection,
  linesCustomerPayment,
  linesCustomerRefund,
  linesExpense,
  linesIvaRetention,
  linesPoPayment,
  linesPoReceive,
  linesPoRefund,
  linesSaleRecognition,
  linesShippingPaid,
  linesStockAdjust,
  treasuryFromPaymentMethod,
  type Settlement,
  type Treasury,
} from '../domain/accounting-posting.js';
import { prisma } from '../db.js';
import { splitIva11 } from '../domain/iva.js';
import { badRequest, notFound } from '../http-error.js';
import { operationMemo } from '../domain/operation-number.js';
import { findActiveEntry, postEntry, reverseActive, reverseEntry, rewriteActiveEntry } from './journal.service.js';
import { addLot, consumeForOrder, removeLotsForPurchaseOrder, restoreForOrder } from './fifo.service.js';
import { applyOrderReservation, restoreOrderSale } from './stock.service.js';

type Tx = Prisma.TransactionClient;

async function orderRef(tx: Tx, orderId: string) {
  const row = await tx.order.findUnique({
    where: { id: orderId },
    select: { numberLabel: true, invoiceNumber: true },
  });
  return {
    ref: row?.numberLabel || orderId.slice(-6),
    invoiceNumber: row?.invoiceNumber ?? null,
  };
}

async function poRef(tx: Tx, id: string) {
  const row = await tx.purchaseOrder.findUnique({ where: { id }, select: { numberLabel: true } });
  return row?.numberLabel || id.slice(-6);
}

export function saleCloseMemo(ref: string, invoiceNumber?: string | null) {
  return operationMemo('ORDER', 'CLOSE', ref, invoiceNumber);
}

export async function postOrderPayment(
  tx: Tx,
  input: {
    orderId: string;
    paymentId: string;
    amount: number;
    method: PaymentMethod;
    paidAt: Date;
    orderClosed: boolean;
    settlement: InvoiceSettlement;
  },
) {
  const treasury = treasuryFromPaymentMethod(input.method);
  const { ref } = await orderRef(tx, input.orderId);
  const text = operationMemo('PAYMENT', 'PAY', ref);
  const closedCredit = input.orderClosed && input.settlement === InvoiceSettlement.CREDITO;
  const lines = closedCredit
    ? linesCreditCollection(input.amount, treasury, text)
    : linesCustomerPayment(input.amount, treasury, text);
  return postEntry(tx, {
    datedAt: input.paidAt,
    memo: text,
    sourceType: JournalSource.PAYMENT,
    sourceId: input.paymentId,
    event: 'PAY',
    lines,
  });
}

export async function postIvaRetention(
  tx: Tx,
  input: { orderId: string; amount: number; datedAt: Date; certificate?: string | null },
) {
  if (input.amount < 1) return null;
  const { ref } = await orderRef(tx, input.orderId);
  const text = input.certificate
    ? `Retención IVA ${input.certificate}`
    : operationMemo('ORDER', 'IVA_RET', ref);
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: text,
    sourceType: JournalSource.ORDER,
    sourceId: input.orderId,
    event: 'IVA_RET',
    lines: linesIvaRetention(input.amount, text),
  });
}

export async function postOrderRefund(
  tx: Tx,
  input: { orderId: string; paymentId: string; amount: number; method: PaymentMethod; paidAt: Date },
) {
  const treasury = treasuryFromPaymentMethod(input.method);
  const { ref } = await orderRef(tx, input.orderId);
  const text = operationMemo('PAYMENT', 'REFUND', ref);
  return postEntry(tx, {
    datedAt: input.paidAt,
    memo: text,
    sourceType: JournalSource.PAYMENT,
    sourceId: input.paymentId,
    event: 'REFUND',
    lines: linesCustomerRefund(input.amount, treasury, text),
  });
}

export async function postOrderClose(
  tx: Tx,
  input: {
    orderId: string;
    datedAt: Date;
    gross: number;
    prepaid: number;
    settlement: InvoiceSettlement;
    invoiceNumber?: string | null;
    lines: Array<{ productId: string; sku: string; quantity: number }>;
  },
) {
  const { ref, invoiceNumber } = await orderRef(tx, input.orderId);
  const saleMemo = saleCloseMemo(ref, input.invoiceNumber ?? invoiceNumber);
  const saleLines = linesSaleRecognition({
    gross: input.gross,
    settlement: input.settlement as Settlement,
    prepaid: input.prepaid,
    memo: saleMemo,
  });
  await postEntry(tx, {
    datedAt: input.datedAt,
    memo: saleMemo,
    sourceType: JournalSource.ORDER,
    sourceId: input.orderId,
    event: 'CLOSE',
    lines: saleLines,
  });

  const already = await tx.lotConsumption.findMany({ where: { orderId: input.orderId } });
  let totalCogs = already.reduce((sum, row) => sum + row.quantity * row.unitCostPyg, 0);
  if (!already.length) {
    for (const line of input.lines) {
      const consumed = await consumeForOrder(tx, input.orderId, line.productId, line.quantity);
      totalCogs += consumed.totalCostPyg;
    }
  }
  if (totalCogs > 0) {
    const cogsMemo = operationMemo('ORDER', 'COGS', ref);
    await postEntry(tx, {
      datedAt: input.datedAt,
      memo: cogsMemo,
      sourceType: JournalSource.ORDER,
      sourceId: input.orderId,
      event: 'COGS',
      lines: linesCogs(totalCogs, cogsMemo),
    });
  }
}

export async function reverseOrderClose(tx: Tx, orderId: string, datedAt: Date) {
  await restoreForOrder(tx, orderId);
  await reverseActive(tx, JournalSource.ORDER, orderId, 'COGS', datedAt);
  await reverseActive(tx, JournalSource.ORDER, orderId, 'CLOSE', datedAt);
}

export async function postShippingCost(tx: Tx, orderId: string, amountPyg: number | null, datedAt: Date) {
  if (amountPyg == null || amountPyg < 1) {
    await reverseActive(tx, JournalSource.ORDER, orderId, 'SHIPPING', datedAt);
    return null;
  }
  const { ref } = await orderRef(tx, orderId);
  const text = operationMemo('ORDER', 'SHIPPING', ref);
  return rewriteActiveEntry(tx, {
    datedAt,
    memo: text,
    sourceType: JournalSource.ORDER,
    sourceId: orderId,
    event: 'SHIPPING',
    lines: linesShippingPaid(amountPyg, text),
  });
}

export async function syncClosedOrderJournals(
  tx: Tx,
  input: {
    orderId: string;
    gross: number;
    prepaid: number;
    settlement: InvoiceSettlement;
    invoiceNumber?: string | null;
    items: Array<{ sku: string; quantity: number }>;
    rebuildLots: boolean;
  },
) {
  const existing = await findActiveEntry(tx, JournalSource.ORDER, input.orderId, 'CLOSE');
  const datedAt = existing?.datedAt ?? new Date();
  const { ref } = await orderRef(tx, input.orderId);
  const saleMemo = saleCloseMemo(ref, input.invoiceNumber);
  await rewriteActiveEntry(tx, {
    datedAt,
    memo: saleMemo,
    sourceType: JournalSource.ORDER,
    sourceId: input.orderId,
    event: 'CLOSE',
    lines: linesSaleRecognition({
      gross: input.gross,
      settlement: input.settlement as Settlement,
      prepaid: input.prepaid,
      memo: saleMemo,
    }),
  });

  if (!input.rebuildLots) return;

  await restoreForOrder(tx, input.orderId);
  let totalCogs = 0;
  for (const line of input.items) {
    const product = await tx.product.findUnique({ where: { sku: line.sku } });
    if (!product) badRequest(`SKU desconocido: ${line.sku}`);
    const consumed = await consumeForOrder(tx, input.orderId, product.id, line.quantity);
    totalCogs += consumed.totalCostPyg;
  }
  if (totalCogs > 0) {
    const cogsMemo = operationMemo('ORDER', 'COGS', ref);
    await rewriteActiveEntry(tx, {
      datedAt,
      memo: cogsMemo,
      sourceType: JournalSource.ORDER,
      sourceId: input.orderId,
      event: 'COGS',
      lines: linesCogs(totalCogs, cogsMemo),
    });
  } else {
    await reverseActive(tx, JournalSource.ORDER, input.orderId, 'COGS', datedAt);
  }
}

type PurchaseJournalPo = {
  id: string;
  freight: unknown;
  otherCharges: unknown;
  fxRateToPyg: unknown;
  currency: string;
  lines: Array<{ productId: string; quantity: number; unitPrice: unknown }>;
};

function purchaseLines(po: PurchaseJournalPo) {
  return po.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: asString(line.unitPrice as never) ?? '0',
  }));
}

export function purchaseChinaPyg(po: PurchaseJournalPo): number {
  const merch = merchandiseFromLines(purchaseLines(po));
  return (
    chinaCostFromMerchandise(
      merch,
      asString(po.freight as never),
      asString(po.otherCharges as never),
      asString(po.fxRateToPyg as never),
      po.currency,
    ) ?? 0
  );
}

export async function postPurchasePay(
  tx: Tx,
  po: PurchaseJournalPo & { treasury: Treasury; confirmedAt: Date },
) {
  const chinaPyg = purchaseChinaPyg(po);
  if (chinaPyg < 1) return null;
  const ref = await poRef(tx, po.id);
  const text = operationMemo('PURCHASE_ORDER', 'PAY', ref);
  return postEntry(tx, {
    datedAt: po.confirmedAt,
    memo: text,
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: po.id,
    event: 'PAY',
    lines: linesPoPayment(chinaPyg, po.treasury, text),
  });
}

export async function postPurchaseClose(
  tx: Tx,
  po: {
    id: string;
    receivedAt: Date;
    customsCost: unknown;
    dispatchCost: unknown;
    localTreasury: Treasury;
    currency: string;
    freight: unknown;
    otherCharges: unknown;
    fxRateToPyg: unknown;
    lines: Array<{ productId: string; quantity: number; unitPrice: unknown }>;
  },
) {
  const merch = merchandiseFromLines(
    po.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: asString(line.unitPrice as never) ?? '0',
    })),
  );
  const chinaPyg =
    chinaCostFromMerchandise(
      merch,
      asString(po.freight as never),
      asString(po.otherCharges as never),
      asString(po.fxRateToPyg as never),
      po.currency,
    ) ?? 0;
  const localGross = Math.round(Number(asString(po.customsCost as never) || 0) + Number(asString(po.dispatchCost as never) || 0));
  const localNet = splitIva11(Math.max(0, localGross)).net;
  const ref = await poRef(tx, po.id);
  const text = operationMemo('PURCHASE_ORDER', 'CLOSE', ref);
  await postEntry(tx, {
    datedAt: po.receivedAt,
    memo: text,
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: po.id,
    event: 'CLOSE',
    lines: linesPoReceive({
      chinaPyg,
      localGross: Math.max(0, localGross),
      treasury: po.localTreasury,
      memo: text,
    }),
  });

  const landedNet = chinaPyg + localNet;
  for (const line of po.lines) {
    const share = merch > 0 ? (Number(asString(line.unitPrice as never) ?? '0') * line.quantity) / merch : 0;
    const lineCost = Math.round(landedNet * share);
    const unitCostPyg = line.quantity > 0 ? Math.round(lineCost / line.quantity) : 0;
    await addLot(tx, {
      productId: line.productId,
      purchaseOrderId: po.id,
      receivedAt: po.receivedAt,
      quantity: line.quantity,
      unitCostPyg,
    });
    await tx.product.update({
      where: { id: line.productId },
      data: { unitCostPyg },
    });
  }
}

export async function postPurchaseCancelRefund(
  tx: Tx,
  input: { id: string; amount: number; treasury: Treasury; datedAt: Date; status: PurchaseOrderStatus },
) {
  if (input.amount < 1) return null;
  const ref = await poRef(tx, input.id);
  const text = operationMemo('PURCHASE_ORDER', 'REFUND', ref);
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: text,
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: input.id,
    event: 'REFUND',
    lines: linesPoRefund(input.amount, input.treasury, text),
  });
}

export async function reversePurchaseClose(tx: Tx, purchaseOrderId: string, datedAt: Date) {
  await reverseActive(tx, JournalSource.PURCHASE_ORDER, purchaseOrderId, 'CLOSE', datedAt);
}

export async function syncPurchaseOrderJournals(
  tx: Tx,
  po: PurchaseJournalPo & {
    status: PurchaseOrderStatus;
    treasury: Treasury;
    localTreasury: Treasury;
    confirmedAt: Date | null;
    receivedAt: Date | null;
    customsCost: unknown;
    dispatchCost: unknown;
  },
) {
  if (po.status !== PurchaseOrderStatus.CONFIRMADA && po.status !== PurchaseOrderStatus.CERRADA) {
    return;
  }
  const chinaPyg = purchaseChinaPyg(po);
  const payAt = po.confirmedAt ?? new Date();
  const ref = await poRef(tx, po.id);
  if (chinaPyg < 1) {
    await reverseActive(tx, JournalSource.PURCHASE_ORDER, po.id, 'PAY', payAt);
  } else {
    const payMemo = operationMemo('PURCHASE_ORDER', 'PAY', ref);
    await rewriteActiveEntry(tx, {
      datedAt: payAt,
      memo: payMemo,
      sourceType: JournalSource.PURCHASE_ORDER,
      sourceId: po.id,
      event: 'PAY',
      lines: linesPoPayment(chinaPyg, po.treasury, payMemo),
    });
  }

  if (po.status !== PurchaseOrderStatus.CERRADA) return;

  const receivedAt = po.receivedAt ?? payAt;
  const localGross = Math.round(
    Number(asString(po.customsCost as never) || 0) + Number(asString(po.dispatchCost as never) || 0),
  );
  const localNet = splitIva11(Math.max(0, localGross)).net;
  const merch = merchandiseFromLines(purchaseLines(po));
  await removeLotsForPurchaseOrder(tx, po.id);
  const closeMemo = operationMemo('PURCHASE_ORDER', 'CLOSE', ref);
  await rewriteActiveEntry(tx, {
    datedAt: receivedAt,
    memo: closeMemo,
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: po.id,
    event: 'CLOSE',
    lines: linesPoReceive({
      chinaPyg,
      localGross: Math.max(0, localGross),
      treasury: po.localTreasury,
      memo: closeMemo,
    }),
  });
  const landedNet = chinaPyg + localNet;
  for (const line of po.lines) {
    const share = merch > 0 ? (Number(asString(line.unitPrice as never) ?? '0') * line.quantity) / merch : 0;
    const lineCost = Math.round(landedNet * share);
    const unitCostPyg = line.quantity > 0 ? Math.round(lineCost / line.quantity) : 0;
    await addLot(tx, {
      productId: line.productId,
      purchaseOrderId: po.id,
      receivedAt,
      quantity: line.quantity,
      unitCostPyg,
    });
    await tx.product.update({
      where: { id: line.productId },
      data: { unitCostPyg },
    });
  }
}

export async function postExpenseJournal(
  tx: Tx,
  input: {
    id: string;
    datedAt: Date;
    gross: number;
    ivaIncluded: boolean;
    expenseRole?: string;
    expenseAccountId?: string;
    treasury: Treasury;
    description: string;
    rewrite?: boolean;
  },
) {
  const split = linesExpense({
    gross: input.gross,
    ivaIncluded: input.ivaIncluded,
    expenseRole: input.expenseRole || 'GASTOS_GENERALES',
    treasury: input.treasury,
    memo: input.description,
  });
  if (input.expenseAccountId) {
    const expenseLine = split.find((l) => l.role === (input.expenseRole || 'GASTOS_GENERALES'));
    if (expenseLine) {
      expenseLine.accountId = input.expenseAccountId;
      delete expenseLine.role;
    }
  }
  const expense = await tx.expense.findUnique({ where: { id: input.id }, select: { numberLabel: true } });
  const memoText = expense?.numberLabel ? `${expense.numberLabel} · ${input.description}` : input.description;
  const payload = {
    datedAt: input.datedAt,
    memo: memoText,
    sourceType: JournalSource.EXPENSE,
    sourceId: input.id,
    event: 'PAY',
    lines: split,
  };
  return input.rewrite ? rewriteActiveEntry(tx, payload) : postEntry(tx, payload);
}

export async function postStockAdjustJournal(
  tx: Tx,
  input: { productId: string; movementId: string; costPyg: number; increase: boolean; datedAt: Date; quantity: number },
) {
  if (input.costPyg < 1) return null;
  const text = `Ajuste stock`;
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: text,
    sourceType: JournalSource.STOCK,
    sourceId: input.movementId,
    event: 'ADJUST',
    lines: linesStockAdjust({
      costPyg: input.costPyg,
      increase: input.increase,
      memo: text,
      productId: input.productId,
      quantity: input.quantity,
    }),
  });
}

export async function refreshOrderJournalMemos() {
  const entries = await prisma.journalEntry.findMany({
    select: { id: true, memo: true, sourceType: true, sourceId: true, event: true },
  });
  const orderIds = [...new Set(entries.filter((e) => e.sourceType === JournalSource.ORDER).map((e) => e.sourceId))];
  const poIds = [...new Set(entries.filter((e) => e.sourceType === JournalSource.PURCHASE_ORDER).map((e) => e.sourceId))];
  const expenseIds = [...new Set(entries.filter((e) => e.sourceType === JournalSource.EXPENSE).map((e) => e.sourceId))];
  const paymentIds = [...new Set(entries.filter((e) => e.sourceType === JournalSource.PAYMENT).map((e) => e.sourceId))];

  const [orders, pos, expenses, payments] = await Promise.all([
    orderIds.length
      ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, numberLabel: true, invoiceNumber: true } })
      : [],
    poIds.length
      ? prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, numberLabel: true } })
      : [],
    expenseIds.length
      ? prisma.expense.findMany({ where: { id: { in: expenseIds } }, select: { id: true, numberLabel: true, description: true } })
      : [],
    paymentIds.length
      ? prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, order: { select: { numberLabel: true } } },
        })
      : [],
  ]);
  const orderMap = new Map(orders.map((row) => [row.id, row]));
  const poMap = new Map(pos.map((row) => [row.id, row.numberLabel]));
  const expenseMap = new Map(expenses.map((row) => [row.id, row]));
  const paymentMap = new Map(payments.map((row) => [row.id, row.order.numberLabel]));

  for (const entry of entries) {
    let next = entry.memo;
    if (entry.sourceType === JournalSource.ORDER) {
      const order = orderMap.get(entry.sourceId);
      const ref = order?.numberLabel || entry.sourceId.slice(-6);
      next = operationMemo('ORDER', entry.event, ref, order?.invoiceNumber);
    } else if (entry.sourceType === JournalSource.PAYMENT) {
      const ref = paymentMap.get(entry.sourceId) || entry.sourceId.slice(-6);
      next = operationMemo('PAYMENT', entry.event, ref);
    } else if (entry.sourceType === JournalSource.PURCHASE_ORDER) {
      const ref = poMap.get(entry.sourceId) || entry.sourceId.slice(-6);
      next = operationMemo('PURCHASE_ORDER', entry.event, ref);
    } else if (entry.sourceType === JournalSource.EXPENSE) {
      const expense = expenseMap.get(entry.sourceId);
      if (expense?.numberLabel) next = `${expense.numberLabel} · ${expense.description}`;
    }
    if (next === entry.memo) continue;
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { memo: next } });
    await prisma.journalLine.updateMany({ where: { entryId: entry.id, memo: entry.memo }, data: { memo: next } });
  }
}

export async function deleteJournalEntry(id: string) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { reversedBy: true },
  });
  if (!entry) notFound('Asiento');
  if (entry.reversedBy) badRequest('Este asiento ya está anulado');
  if (entry.reversesId) badRequest('No se puede eliminar una reversión');

  await prisma.$transaction(async (tx) => {
    if (entry.sourceType === JournalSource.ORDER && entry.event === 'CLOSE') {
      await reverseOrderClose(tx, entry.sourceId, new Date());
      await restoreOrderSale(tx, entry.sourceId, 'CANCELACION_PEDIDO');
      const order = await tx.order.findUnique({
        where: { id: entry.sourceId },
        include: { items: true },
      });
      if (order?.status === OrderStatus.CERRADO) {
        await applyOrderReservation(
          tx,
          order.id,
          order.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
        );
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.ENTREGADO } });
      }
      await postShippingCost(tx, entry.sourceId, null, new Date());
      return;
    }
    await reverseEntry(tx, id, new Date());
    if (entry.sourceType === JournalSource.EXPENSE && entry.event === 'PAY') {
      await tx.expense.delete({ where: { id: entry.sourceId } }).catch(() => undefined);
    }
  });
  return { ok: true };
}
