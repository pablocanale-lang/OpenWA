/** Guaraníes: enteros. Acepta 222000, 222.000 o 222.000,50 (coma decimal). */
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
