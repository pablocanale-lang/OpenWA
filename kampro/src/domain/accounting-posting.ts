import { resolveIvaTreatment, splitByTreatment, splitIva11, type IvaTreatment } from './iva.js';
import { compactDraftLines, type DraftLine } from './journal.js';

export type Treasury = 'CAJA' | 'BANCO';
export type Settlement = 'CONTADO' | 'CREDITO';

function t(role: string, debit: number, credit: number, memo?: string, extra?: Partial<DraftLine>): DraftLine {
  return { role, debit, credit, memo, ...extra };
}

export function treasuryRole(treasury: Treasury): 'CAJA' | 'BANCO' {
  return treasury;
}

export function linesCustomerPayment(amount: number, treasury: Treasury, memo: string): DraftLine[] {
  return compactDraftLines([
    t(treasuryRole(treasury), amount, 0, memo),
    t('ANTICIPO_CLIENTES', 0, amount, memo),
  ]);
}

/** Retención de IVA (70% del IVA /11): crédito fiscal en lugar de cobro bancario. */
export function linesIvaRetention(amount: number, memo: string): DraftLine[] {
  return compactDraftLines([
    t('IVA_CREDITO', amount, 0, memo),
    t('ANTICIPO_CLIENTES', 0, amount, memo),
  ]);
}

export function linesCustomerRefund(amount: number, treasury: Treasury, memo: string): DraftLine[] {
  return compactDraftLines([
    t('ANTICIPO_CLIENTES', amount, 0, memo),
    t(treasuryRole(treasury), 0, amount, memo),
  ]);
}

export function linesCreditCollection(amount: number, treasury: Treasury, memo: string): DraftLine[] {
  return compactDraftLines([
    t(treasuryRole(treasury), amount, 0, memo),
    t('CXC', 0, amount, memo),
  ]);
}

/** Une el neto y el IVA de cada línea. Una línea EXENTA aporta iva=0 (splitByTreatment). */
function sumLineSplits(lines: Array<{ grossPyg: number; ivaTreatment: IvaTreatment }>) {
  return lines.reduce(
    (acc, line) => {
      const { net, iva } = splitByTreatment(line.grossPyg, line.ivaTreatment);
      acc.gross += line.grossPyg;
      acc.net += net;
      acc.iva += iva;
      return acc;
    },
    { gross: 0, net: 0, iva: 0 },
  );
}

export function linesSaleRecognition(input: {
  lines: Array<{ grossPyg: number; ivaTreatment: IvaTreatment }>;
  settlement: Settlement;
  prepaid: number;
  memo: string;
}): DraftLine[] {
  const { gross, net, iva } = sumLineSplits(input.lines);
  const prepaid = Math.max(0, Math.min(input.prepaid, gross));
  const unpaid = gross - prepaid;
  // Si todas las líneas son EXENTA, iva=0 y compactDraftLines descarta sola la línea IVA_DEBITO.
  const lines: DraftLine[] = [t('VENTAS', 0, net, input.memo), t('IVA_DEBITO', 0, iva, input.memo)];

  if (input.settlement === 'CREDITO') {
    lines.unshift(t('CXC', gross, 0, input.memo));
    if (prepaid > 0) {
      lines.push(t('ANTICIPO_CLIENTES', prepaid, 0, input.memo), t('CXC', 0, prepaid, input.memo));
    }
  } else {
    if (prepaid > 0) lines.unshift(t('ANTICIPO_CLIENTES', prepaid, 0, input.memo));
    if (unpaid > 0) lines.unshift(t('CXC', unpaid, 0, input.memo));
  }
  return compactDraftLines(lines);
}

export function linesCogs(totalCostPyg: number, memo: string, productId?: string, quantity?: number): DraftLine[] {
  return compactDraftLines([
    t('CMV', totalCostPyg, 0, memo, { productId, quantity }),
    t('INVENTARIO', 0, totalCostPyg, memo, { productId, quantity }),
  ]);
}

export function linesShippingPaid(
  gross: number,
  memo: string,
  ivaTreatment: IvaTreatment = 'IVA_10',
  treasury: Treasury = 'BANCO',
): DraftLine[] {
  const { net, iva } = splitByTreatment(gross, ivaTreatment);
  return compactDraftLines([
    t('FLETE_VENTAS', net, 0, memo),
    t('IVA_CREDITO', iva, 0, memo),
    t(treasuryRole(treasury), 0, gross, memo),
  ]);
}

export function linesPoPayment(chinaPyg: number, treasury: Treasury, memo: string): DraftLine[] {
  return compactDraftLines([
    t('TRANSITO', chinaPyg, 0, memo),
    t(treasuryRole(treasury), 0, chinaPyg, memo),
  ]);
}

export function linesPoReceive(input: {
  chinaPyg: number;
  localGross: number;
  treasury: Treasury;
  memo: string;
}): DraftLine[] {
  const local = splitIva11(input.localGross);
  return compactDraftLines([
    t('INVENTARIO', input.chinaPyg + local.net, 0, input.memo),
    t('TRANSITO', 0, input.chinaPyg, input.memo),
    t('IVA_CREDITO', local.iva, 0, input.memo),
    t(treasuryRole(input.treasury), 0, input.localGross, input.memo),
  ]);
}

export function linesPoRefund(amount: number, treasury: Treasury, memo: string): DraftLine[] {
  return compactDraftLines([
    t(treasuryRole(treasury), amount, 0, memo),
    t('TRANSITO', 0, amount, memo),
  ]);
}

export function linesExpense(input: {
  gross: number;
  ivaIncluded?: boolean;
  ivaTreatment?: IvaTreatment | null;
  expenseRole: string;
  treasury: Treasury;
  memo: string;
}): DraftLine[] {
  const { net, iva } = splitByTreatment(input.gross, resolveIvaTreatment(input));
  return compactDraftLines([
    t(input.expenseRole, net, 0, input.memo),
    t('IVA_CREDITO', iva, 0, input.memo),
    t(treasuryRole(input.treasury), 0, input.gross, input.memo),
  ]);
}

export function linesStockAdjust(input: {
  costPyg: number;
  increase: boolean;
  memo: string;
  productId?: string;
  quantity?: number;
}): DraftLine[] {
  if (input.increase) {
    return compactDraftLines([
      t('INVENTARIO', input.costPyg, 0, input.memo, { productId: input.productId, quantity: input.quantity }),
      t('AJUSTE_INVENTARIO', 0, input.costPyg, input.memo),
    ]);
  }
  return compactDraftLines([
    t('AJUSTE_INVENTARIO', input.costPyg, 0, input.memo, { productId: input.productId, quantity: input.quantity }),
    t('INVENTARIO', 0, input.costPyg, input.memo, { productId: input.productId, quantity: input.quantity }),
  ]);
}

export function treasuryFromPaymentMethod(method: 'EFECTIVO' | 'TRANSFERENCIA'): Treasury {
  return method === 'EFECTIVO' ? 'CAJA' : 'BANCO';
}
