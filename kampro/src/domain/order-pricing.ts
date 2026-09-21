/** 15% automático solo para 2 unidades. 1 y 3–8: no hay regla → 0. No inventar otros %. */
export function discountPercentForQty(quantity: number): number {
  return quantity === 2 ? 15 : 0;
}

export function quoteTotalPyg(unitPricePyg: number, quantity: number, discountPercent: number): number {
  if (!Number.isFinite(unitPricePyg) || unitPricePyg < 0) return 0;
  if (!Number.isInteger(quantity) || quantity < 1) return 0;
  const pct = Number.isFinite(discountPercent) ? Math.min(100, Math.max(0, discountPercent)) : 0;
  return Math.round(unitPricePyg * quantity * (1 - pct / 100));
}

/**
 * % de descuento entero más cercano al que hace falta para llegar a `finalPricePyg` desde el
 * precio de lista (unitPricePyg × quantity). Es solo informativo/de reporte — `finalPricePyg` es
 * el monto que realmente se cobra, no el que resulta de aplicar este % (discountApplied es Int,
 * así que un % exacto no siempre existe: ej. 640.000 -> 600.000 necesita 6,25%, redondea a 6%).
 */
export function discountPercentForFinalPrice(unitPricePyg: number, quantity: number, finalPricePyg: number): number {
  const listTotal = unitPricePyg * quantity;
  if (!Number.isFinite(listTotal) || listTotal <= 0) return 0;
  const pct = (1 - finalPricePyg / listTotal) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function formatPyg(amount: number): string {
  return `${new Intl.NumberFormat('es-PY').format(amount)} Gs`;
}
