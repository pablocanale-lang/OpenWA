export type DraftLine = {
  role?: string;
  accountId?: string;
  debit: number;
  credit: number;
  memo?: string;
  productId?: string;
  quantity?: number;
};

export function formatJournalNumber(n: number): string {
  return `A-${String(n).padStart(6, '0')}`;
}

export function lineTotals(lines: Array<{ debit: number; credit: number }>): { debit: number; credit: number } {
  return {
    debit: lines.reduce((sum, line) => sum + line.debit, 0),
    credit: lines.reduce((sum, line) => sum + line.credit, 0),
  };
}

export function compactDraftLines(lines: DraftLine[]): DraftLine[] {
  const out: DraftLine[] = [];
  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) continue;
    if (line.debit < 0 || line.credit < 0) throw new Error('Débito y crédito no pueden ser negativos');
    if (line.debit > 0 && line.credit > 0) throw new Error('Una línea no puede tener débito y crédito a la vez');
    out.push(line);
  }
  return out;
}

export function assertBalanced(lines: Array<{ debit: number; credit: number }>): void {
  const compact = compactDraftLines(lines.map((line) => ({ debit: line.debit, credit: line.credit })));
  if (!compact.length) throw new Error('El asiento no tiene líneas');
  const { debit, credit } = lineTotals(compact);
  if (debit !== credit) throw new Error(`Asiento desbalanceado: débito ${debit} crédito ${credit}`);
}

export function reverseLines<T extends { debit: number; credit: number }>(lines: T[]): T[] {
  return lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
}
