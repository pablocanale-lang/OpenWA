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
