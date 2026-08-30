export const OP_KINDS = ['purchase-order', 'order', 'expense'] as const;
export type OpKind = (typeof OP_KINDS)[number];

export const OP_PREFIX: Record<OpKind, string> = {
  'purchase-order': 'OC',
  order: 'PV',
  expense: 'G',
};

export function formatOpNumber(kind: OpKind, n: number): string {
  return `${OP_PREFIX[kind]}-${String(n).padStart(6, '0')}`;
}

export function operationMemo(
  sourceType: 'ORDER' | 'PAYMENT' | 'PURCHASE_ORDER' | 'EXPENSE' | 'STOCK' | 'MANUAL',
  event: string,
  ref: string,
  invoiceNumber?: string | null,
): string {
  if (sourceType === 'ORDER') {
    if (event === 'CLOSE' || event.startsWith('CLOSE')) {
      return invoiceNumber ? `Venta ${ref} · ${invoiceNumber}` : `Venta ${ref}`;
    }
    if (event.startsWith('COGS')) return `CMV ${ref}`;
    if (event.startsWith('SHIPPING')) return `Flete venta ${ref}`;
    if (event.startsWith('IVA_RET')) return `Retención IVA ${ref}`;
  }
  if (sourceType === 'PAYMENT') {
    if (event.includes('REFUND')) return `Reembolso ${ref}`;
    return `Cobro ${ref}`;
  }
  if (sourceType === 'PURCHASE_ORDER') {
    if (event.startsWith('CLOSE')) return `Recepción ${ref}`;
    if (event.includes('REFUND')) return `Devolución pago ${ref}`;
    return `Pago ${ref}`;
  }
  if (sourceType === 'EXPENSE') return ref;
  return ref;
}
