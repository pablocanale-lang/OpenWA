import {
  InvoiceSettlement,
  JournalSource,
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
import { splitIva11 } from '../domain/iva.js';
import { postEntry, replaceEntry, reverseActive } from './journal.service.js';
import { addLot, consumeForOrder, restoreForOrder } from './fifo.service.js';

type Tx = Prisma.TransactionClient;

function memo(prefix: string, id: string) {
  return `${prefix} ${id.slice(-6)}`;
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
  const closedCredit = input.orderClosed && input.settlement === InvoiceSettlement.CREDITO;
  const lines = closedCredit
    ? linesCreditCollection(input.amount, treasury, memo('Cobro pedido', input.orderId))
    : linesCustomerPayment(input.amount, treasury, memo('Cobro pedido', input.orderId));
  return postEntry(tx, {
    datedAt: input.paidAt,
    memo: memo('Cobro pedido', input.orderId),
    sourceType: JournalSource.PAYMENT,
    sourceId: input.paymentId,
    event: 'PAY',
    lines,
  });
}

export async function postOrderRefund(
  tx: Tx,
  input: { orderId: string; paymentId: string; amount: number; method: PaymentMethod; paidAt: Date },
) {
  const treasury = treasuryFromPaymentMethod(input.method);
  return postEntry(tx, {
    datedAt: input.paidAt,
    memo: memo('Reembolso pedido', input.orderId),
    sourceType: JournalSource.PAYMENT,
    sourceId: input.paymentId,
    event: 'REFUND',
    lines: linesCustomerRefund(input.amount, treasury, memo('Reembolso pedido', input.orderId)),
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
    lines: Array<{ productId: string; sku: string; quantity: number }>;
  },
) {
  const saleMemo = memo('Cierre venta', input.orderId);
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

  let totalCogs = 0;
  for (const line of input.lines) {
    const consumed = await consumeForOrder(tx, input.orderId, line.productId, line.quantity);
    totalCogs += consumed.totalCostPyg;
  }
  if (totalCogs > 0) {
    await postEntry(tx, {
      datedAt: input.datedAt,
      memo: memo('CMV pedido', input.orderId),
      sourceType: JournalSource.ORDER,
      sourceId: input.orderId,
      event: 'COGS',
      lines: linesCogs(totalCogs, memo('CMV pedido', input.orderId)),
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
  return replaceEntry(tx, {
    datedAt,
    memo: memo('Flete venta', orderId),
    sourceType: JournalSource.ORDER,
    sourceId: orderId,
    event: 'SHIPPING',
    lines: linesShippingPaid(amountPyg, memo('Flete venta', orderId)),
  });
}

export async function postPurchasePay(
  tx: Tx,
  po: {
    id: string;
    quantity: number;
    unitPrice: unknown;
    freight: unknown;
    otherCharges: unknown;
    fxRateToPyg: unknown;
    currency: string;
    treasury: Treasury;
    confirmedAt: Date;
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
  if (chinaPyg < 1) return null;
  return postEntry(tx, {
    datedAt: po.confirmedAt,
    memo: memo('Pago OC', po.id),
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: po.id,
    event: 'PAY',
    lines: linesPoPayment(chinaPyg, po.treasury, memo('Pago OC', po.id)),
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
  await postEntry(tx, {
    datedAt: po.receivedAt,
    memo: memo('Recepción OC', po.id),
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: po.id,
    event: 'CLOSE',
    lines: linesPoReceive({
      chinaPyg,
      localGross: Math.max(0, localGross),
      treasury: po.localTreasury,
      memo: memo('Recepción OC', po.id),
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
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: memo('Devolución pago OC', input.id),
    sourceType: JournalSource.PURCHASE_ORDER,
    sourceId: input.id,
    event: 'REFUND',
    lines: linesPoRefund(input.amount, input.treasury, memo('Devolución pago OC', input.id)),
  });
}

export async function reversePurchaseClose(tx: Tx, purchaseOrderId: string, datedAt: Date) {
  await reverseActive(tx, JournalSource.PURCHASE_ORDER, purchaseOrderId, 'CLOSE', datedAt);
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
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: input.description,
    sourceType: JournalSource.EXPENSE,
    sourceId: input.id,
    event: 'PAY',
    lines: split,
  });
}

export async function postStockAdjustJournal(
  tx: Tx,
  input: { productId: string; movementId: string; costPyg: number; increase: boolean; datedAt: Date; quantity: number },
) {
  if (input.costPyg < 1) return null;
  return postEntry(tx, {
    datedAt: input.datedAt,
    memo: memo('Ajuste stock', input.productId),
    sourceType: JournalSource.STOCK,
    sourceId: input.movementId,
    event: 'ADJUST',
    lines: linesStockAdjust({
      costPyg: input.costPyg,
      increase: input.increase,
      memo: memo('Ajuste stock', input.productId),
      productId: input.productId,
      quantity: input.quantity,
    }),
  });
}
