/** Próxima factura a emitir: 001-001-0000014. Emisor actual: Pablo Canale. */
export const DEFAULT_INVOICE_ISSUER = 'Pablo Canale';
export const FIRST_INVOICE_NUMBER = 14;
export const DEFAULT_INVOICE_ESTABLISHMENT = '001';
export const DEFAULT_INVOICE_POINT = '001';

export type ParsedInvoiceNumber = {
  establishment: string;
  point: string;
  sequence: number;
};

export function formatInvoiceNumber(
  sequence: number,
  establishment = DEFAULT_INVOICE_ESTABLISHMENT,
  point = DEFAULT_INVOICE_POINT,
): string {
  const n = Math.max(1, Math.floor(sequence));
  return `${establishment}-${point}-${String(n).padStart(7, '0')}`;
}

export function parseInvoiceNumber(raw: string): ParsedInvoiceNumber {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('El número de factura es obligatorio');
  }
  const full = trimmed.match(/^(\d{1,3})-(\d{1,3})-(\d{1,7})$/);
  if (full) {
    const sequence = Number(full[3]);
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new Error('El número de factura debe ser mayor a 0');
    }
    return {
      establishment: full[1].padStart(3, '0'),
      point: full[2].padStart(3, '0'),
      sequence,
    };
  }
  if (/^\d{1,7}$/.test(trimmed)) {
    const sequence = Number(trimmed);
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new Error('El número de factura debe ser mayor a 0');
    }
    return {
      establishment: DEFAULT_INVOICE_ESTABLISHMENT,
      point: DEFAULT_INVOICE_POINT,
      sequence,
    };
  }
  throw new Error('La factura debe ser 001-001-0000016 o el número consecutivo');
}

export function normalizeInvoiceNumber(raw: string): string {
  const parsed = parseInvoiceNumber(raw);
  return formatInvoiceNumber(parsed.sequence, parsed.establishment, parsed.point);
}

/** Si se salta números anulados, la próxima automática queda después del mayor usado. */
export function sequenceAfterAssign(currentNext: number, assignedSequence: number): number {
  return Math.max(currentNext, assignedSequence + 1);
}
