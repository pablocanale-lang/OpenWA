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

export function formatPyg(amount: number): string {
  return `${new Intl.NumberFormat('es-PY').format(amount)} Gs`;
}

export type OrderLineDraft = {
  key: string;
  sku: string;
  quantity: number;
  discount: number;
  unitPrice: number;
};

export function lineTotalPyg(line: Pick<OrderLineDraft, 'unitPrice' | 'quantity' | 'discount'>): number {
  return quoteTotalPyg(line.unitPrice, line.quantity, line.discount);
}

export function quoteLinesTotalPyg(lines: Array<Pick<OrderLineDraft, 'unitPrice' | 'quantity' | 'discount'>>): number {
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
