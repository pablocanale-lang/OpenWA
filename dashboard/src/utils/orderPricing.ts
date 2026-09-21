/** 15% automático solo para 2 unidades. 1 y 3–8: no hay regla → 0. */
export function discountPercentForQty(quantity: number): number {
  return quantity === 2 ? 15 : 0;
}

export function quoteTotalPyg(unitPricePyg: number, quantity: number, discountPercent: number): number {
  if (!Number.isFinite(unitPricePyg) || unitPricePyg < 0) return 0;
  if (!Number.isInteger(quantity) || quantity < 1) return 0;
  const pct = Number.isFinite(discountPercent) ? Math.min(100, Math.max(0, discountPercent)) : 0;
  return Math.round(unitPricePyg * quantity * (1 - pct / 100));
}

/** Espejo de kampro/src/domain/order-pricing.ts — ver ahí el porqué (discountApplied es Int). */
export function discountPercentForFinalPrice(unitPricePyg: number, quantity: number, finalPricePyg: number): number {
  const listTotal = unitPricePyg * quantity;
  if (!Number.isFinite(listTotal) || listTotal <= 0) return 0;
  const pct = (1 - finalPricePyg / listTotal) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function formatPyg(amount: number): string {
  return `${new Intl.NumberFormat('es-PY').format(amount)} Gs`;
}

/** Guaraníes enteros. Acepta 222000 o 222.000. */
export function parsePygInput(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const text = String(raw ?? '').trim();
  if (!text) return Number.NaN;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(text)
      ? text.replace(/\./g, '')
      : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value) : Number.NaN;
}

export type OrderLineIvaTreatment = 'IVA_10' | 'IVA_5' | 'EXENTA';

export type OrderLineDraft = {
  key: string;
  sku: string;
  quantity: number;
  discount: number;
  unitPrice: number;
  ivaTreatment: OrderLineIvaTreatment;
  /// Precio final opcional: si está cargado, manda sobre `discount` (ver discountPercentForFinalPrice).
  finalPrice?: number;
};

export function lineTotalPyg(line: Pick<OrderLineDraft, 'unitPrice' | 'quantity' | 'discount' | 'finalPrice'>): number {
  if (line.finalPrice != null && line.finalPrice > 0) return Math.round(line.finalPrice);
  return quoteTotalPyg(line.unitPrice, line.quantity, line.discount);
}

export function quoteLinesTotalPyg(
  lines: Array<Pick<OrderLineDraft, 'unitPrice' | 'quantity' | 'discount' | 'finalPrice'>>,
): number {
  return lines.reduce((sum, line) => sum + lineTotalPyg(line), 0);
}

export function sanitizeRucInput(raw: string): string {
  return raw.replace(/[^0-9-]/g, '');
}

export function toDatetimeLocalValue(raw: string): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
    return raw.slice(0, 16);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
