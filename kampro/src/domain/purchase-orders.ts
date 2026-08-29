import { pygFrom } from '../money.js';

export const PURCHASE_ORDER_STATUSES = ['BORRADOR', 'CONFIRMADA', 'CERRADA', 'CANCELADA'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_CURRENCIES = ['PYG', 'USD', 'JPY'] as const;
export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];

export type StockDelta = { productId: string; quantity: number };

export type PurchaseOrderLineInput = {
  productId: string;
  quantity: number;
  unitPrice: string | number;
};

export type PurchaseOrderInvoiceInput = {
  invoiceNumber: string;
  ruc: string;
  legalName: string;
  issuedAt: Date;
  amount: string;
};

export function normalizePurchaseCurrency(value: string | null | undefined): PurchaseCurrency {
  const raw = (value || 'USD').trim().toUpperCase();
  if (raw === 'GS' || raw === 'PYG' || raw === 'GUARANI' || raw === 'GUARANÍ') return 'PYG';
  if (raw === 'YEN' || raw === 'JPY' || raw === '¥') return 'JPY';
  if (raw === 'USD' || raw === 'US$' || raw === '$') return 'USD';
  throw new Error('La moneda de la orden debe ser PYG, USD o Yen');
}

export function needsExchangeRate(currency: string | null | undefined): boolean {
  return normalizePurchaseCurrency(currency) !== 'PYG';
}

export function resolveFxRate(
  currency: string | null | undefined,
  fxRateToPyg: string | number | null | undefined,
): string | number | null {
  if (!needsExchangeRate(currency)) return null;
  if (fxRateToPyg === null || fxRateToPyg === undefined || fxRateToPyg === '') {
    throw new Error('Con USD o Yen hay que indicar el tipo de cambio a guaraníes');
  }
  const fx = Number(fxRateToPyg);
  if (!Number.isFinite(fx) || fx <= 0) throw new Error('El tipo de cambio debe ser mayor a 0');
  return fxRateToPyg;
}

export function merchandiseTotal(quantity: number, unitPrice: string | number): number {
  return Number(unitPrice) * quantity;
}

export function merchandiseFromLines(lines: PurchaseOrderLineInput[]): number {
  return lines.reduce((sum, line) => sum + merchandiseTotal(line.quantity, line.unitPrice), 0);
}

export function totalQuantity(lines: PurchaseOrderLineInput[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function assertPurchaseLines(lines: PurchaseOrderLineInput[]): void {
  if (!lines.length) throw new Error('La orden de compra necesita al menos un producto');
  for (const line of lines) {
    if (!line.productId?.trim()) throw new Error('Cada línea necesita un producto');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('La cantidad de cada producto debe ser mayor a 0');
    }
    const price = Number(line.unitPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('El precio por unidad debe ser mayor a 0');
  }
}

export function openTotal(
  quantity: number,
  unitPrice: string | number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
): number {
  return merchandiseTotal(quantity, unitPrice) + Number(freight || 0) + Number(otherCharges || 0);
}

export function openTotalFromMerchandise(
  merchandise: number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
): number {
  return merchandise + Number(freight || 0) + Number(otherCharges || 0);
}

export function landedTotal(
  quantity: number,
  unitPrice: string | number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
  customsCost: string | number | null | undefined,
  dispatchCost: string | number | null | undefined,
): number {
  return openTotal(quantity, unitPrice, freight, otherCharges) + Number(customsCost || 0) + Number(dispatchCost || 0);
}

export function chinaCostPyg(
  quantity: number,
  unitPrice: string | number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
  fxRateToPyg: string | number | null | undefined,
  currency: string | null | undefined = 'USD',
): number | null {
  return pygFrom(openTotal(quantity, unitPrice, freight, otherCharges), normalizePurchaseCurrency(currency), fxRateToPyg);
}

export function chinaCostFromMerchandise(
  merchandise: number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
  fxRateToPyg: string | number | null | undefined,
  currency: string | null | undefined = 'USD',
): number | null {
  return pygFrom(
    openTotalFromMerchandise(merchandise, freight, otherCharges),
    normalizePurchaseCurrency(currency),
    fxRateToPyg,
  );
}

export function spentForStatus(
  status: PurchaseOrderStatus,
  quantity: number,
  unitPrice: string | number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
  customsCost: string | number | null | undefined,
  dispatchCost: string | number | null | undefined,
  fxRateToPyg?: string | number | null,
  currency: string | null | undefined = 'USD',
): number {
  if (status === 'BORRADOR' || status === 'CANCELADA') return 0;
  const china = chinaCostPyg(quantity, unitPrice, freight, otherCharges, fxRateToPyg, currency);
  const local = status === 'CERRADA' ? Number(customsCost || 0) + Number(dispatchCost || 0) : 0;
  return (china ?? 0) + local;
}

export function spentFromMerchandise(
  status: PurchaseOrderStatus,
  merchandise: number,
  freight: string | number | null | undefined,
  otherCharges: string | number | null | undefined,
  customsCost: string | number | null | undefined,
  dispatchCost: string | number | null | undefined,
  fxRateToPyg: string | number | null | undefined,
  currency: string | null | undefined,
): number {
  if (status === 'BORRADOR' || status === 'CANCELADA') return 0;
  const china = chinaCostFromMerchandise(merchandise, freight, otherCharges, fxRateToPyg, currency);
  const local = status === 'CERRADA' ? Number(customsCost || 0) + Number(dispatchCost || 0) : 0;
  return (china ?? 0) + local;
}

export function quantityForStatus(status: PurchaseOrderStatus, quantity: number): number {
  return status === 'BORRADOR' || status === 'CANCELADA' ? 0 : quantity;
}

export function assertCanEdit(status: PurchaseOrderStatus): void {
  if (status === 'CANCELADA') {
    throw new Error('No se puede editar una orden de compra cancelada');
  }
}

export function assertCanCancel(status: PurchaseOrderStatus): void {
  if (status === 'CANCELADA') {
    throw new Error('Esta orden de compra ya está cancelada');
  }
}

export function assertCancelRefund(
  status: PurchaseOrderStatus,
  refund?: { amountPyg: number; treasury: string; paidAt: Date } | null,
): void {
  assertCanCancel(status);
  if (status === 'BORRADOR') return;
  if (!refund || !Number.isFinite(refund.amountPyg) || refund.amountPyg < 1) {
    throw new Error('Para cancelar una orden pagada hay que registrar la devolución del dinero');
  }
  if (refund.treasury !== 'CAJA' && refund.treasury !== 'BANCO') {
    throw new Error('La devolución va a caja o al banco');
  }
}

export function qtyByProduct(lines: PurchaseOrderLineInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.productId, (map.get(line.productId) || 0) + line.quantity);
  }
  return map;
}

export function stockDeltasOnCancel(status: PurchaseOrderStatus, productId: string, quantity: number): StockDelta[] {
  return stockDeltasOnLinesCancel(status, [{ productId, quantity, unitPrice: 1 }]);
}

export function stockDeltasOnLinesCancel(status: PurchaseOrderStatus, lines: PurchaseOrderLineInput[]): StockDelta[] {
  if (status !== 'CERRADA') return [];
  return [...qtyByProduct(lines)].map(([productId, quantity]) => ({ productId, quantity: -quantity })).filter((d) => d.quantity !== 0);
}

export function stockDeltasOnEdit(
  status: PurchaseOrderStatus,
  prevProductId: string,
  prevQty: number,
  nextProductId: string,
  nextQty: number,
): StockDelta[] {
  return stockDeltasOnLinesEdit(
    status,
    [{ productId: prevProductId, quantity: prevQty, unitPrice: 1 }],
    [{ productId: nextProductId, quantity: nextQty, unitPrice: 1 }],
  );
}

export function stockDeltasOnLinesEdit(
  status: PurchaseOrderStatus,
  prevLines: PurchaseOrderLineInput[],
  nextLines: PurchaseOrderLineInput[],
): StockDelta[] {
  if (status !== 'CERRADA') return [];
  const prev = qtyByProduct(prevLines);
  const next = qtyByProduct(nextLines);
  const ids = new Set([...prev.keys(), ...next.keys()]);
  const deltas: StockDelta[] = [];
  for (const id of ids) {
    const delta = (next.get(id) || 0) - (prev.get(id) || 0);
    if (delta) deltas.push({ productId: id, quantity: delta });
  }
  return deltas;
}

export function assertCanConfirm(status: PurchaseOrderStatus, paymentReceipt: string | null | undefined): void {
  if (status !== 'BORRADOR') {
    throw new Error('Solo se confirma una orden de compra en borrador');
  }
  if (!paymentReceipt?.trim()) {
    throw new Error('Para confirmar la orden de compra hay que cargar el comprobante de pago');
  }
}

export function isInvoiceDraftBlank(invoice: {
  invoiceNumber?: string;
  ruc?: string;
  legalName?: string;
  amount?: string;
}): boolean {
  return ![invoice.invoiceNumber, invoice.ruc, invoice.legalName, invoice.amount].some((value) => String(value || '').trim());
}

export function completeInvoices<T extends PurchaseOrderInvoiceInput>(invoices: T[]): T[] {
  return invoices.filter((invoice) => !isInvoiceDraftBlank(invoice));
}

export function assertInvoice(invoice: PurchaseOrderInvoiceInput): void {
  if (!invoice.invoiceNumber.trim()) throw new Error('La factura necesita número');
  if (!invoice.ruc.trim()) throw new Error('La factura necesita RUC');
  if (!invoice.legalName.trim()) throw new Error('La factura necesita razón social');
  if (!(invoice.issuedAt instanceof Date) || Number.isNaN(invoice.issuedAt.getTime())) {
    throw new Error('La factura necesita fecha');
  }
  const amount = Number(invoice.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('La factura necesita un monto válido');
}

export function assertCanClose(
  status: PurchaseOrderStatus,
  data: {
    receivedAt: Date | null | undefined;
    customsCost: string | number | null | undefined;
    dispatchCost: string | number | null | undefined;
    invoices: PurchaseOrderInvoiceInput[];
  },
): void {
  if (status !== 'CONFIRMADA') {
    throw new Error('Solo se cierra una orden de compra confirmada');
  }
  if (!data.receivedAt || Number.isNaN(data.receivedAt.getTime())) {
    throw new Error('Para cerrar hay que indicar la fecha de recepción');
  }
  if (data.customsCost === null || data.customsCost === undefined || data.customsCost === '') {
    throw new Error('Para cerrar hay que detallar el costo de aduana');
  }
  if (data.dispatchCost === null || data.dispatchCost === undefined || data.dispatchCost === '') {
    throw new Error('Para cerrar hay que detallar el costo de despacho');
  }
  const customs = Number(data.customsCost);
  const dispatch = Number(data.dispatchCost);
  if (!Number.isFinite(customs) || customs < 0) throw new Error('El costo de aduana no es válido');
  if (!Number.isFinite(dispatch) || dispatch < 0) throw new Error('El costo de despacho no es válido');
  const invoices = completeInvoices(data.invoices);
  if (!invoices.length) {
    throw new Error('Para cerrar hay que cargar al menos una factura');
  }
  for (const invoice of invoices) assertInvoice(invoice);
}

export function summarizePurchaseOrders<
  T extends {
    status: PurchaseOrderStatus;
    quantity: number;
    unitPrice: string | number;
    freight: string | number | null;
    otherCharges: string | number | null;
    customsCost: string | number | null;
    dispatchCost: string | number | null;
    fxRateToPyg?: string | number | null;
    currency?: string | null;
    merchandiseTotal?: string | number | null;
  },
>(rows: T[]) {
  const draft = rows.filter((r) => r.status === 'BORRADOR').length;
  const open = rows.filter((r) => r.status === 'CONFIRMADA').length;
  const closed = rows.filter((r) => r.status === 'CERRADA').length;
  const cancelled = rows.filter((r) => r.status === 'CANCELADA').length;
  const quantity = rows.reduce((sum, r) => sum + quantityForStatus(r.status, r.quantity), 0);
  const spent = rows.reduce((sum, r) => {
    const merch =
      r.merchandiseTotal !== null && r.merchandiseTotal !== undefined && r.merchandiseTotal !== ''
        ? Number(r.merchandiseTotal)
        : merchandiseTotal(r.quantity, r.unitPrice);
    return (
      sum +
      spentFromMerchandise(
        r.status,
        merch,
        r.freight,
        r.otherCharges,
        r.customsCost,
        r.dispatchCost,
        r.fxRateToPyg,
        r.currency,
      )
    );
  }, 0);
  return { draft, open, closed, cancelled, total: rows.length, quantity, spent };
}
