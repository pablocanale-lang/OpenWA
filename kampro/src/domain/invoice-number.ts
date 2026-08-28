/** Próxima factura a emitir: 001-001-0000014. Emisor actual: Pablo Canale. */
export const DEFAULT_INVOICE_ISSUER = 'Pablo Canale';
export const FIRST_INVOICE_NUMBER = 14;

export function formatInvoiceNumber(sequence: number): string {
  const n = Math.max(1, Math.floor(sequence));
  return `001-001-${String(n).padStart(7, '0')}`;
}
