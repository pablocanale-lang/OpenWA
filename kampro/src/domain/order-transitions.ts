export const ORDER_STATUSES = [
  'CONFIRMADO',
  'PENDIENTE_DE_PAGO',
  'PAGO_CONFIRMADO',
  'LISTO_PARA_DESPACHO',
  'ENVIADO',
  'ENTREGADO',
  'CERRADO',
  'CANCELADO',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderZone = 'ASUNCION' | 'INTERIOR';
export type OrderAction =
  | 'confirmPayment'
  | 'markReady'
  | 'markShipped'
  | 'markDelivered'
  | 'close'
  | 'cancel';

export function initialStatusForZone(zone: OrderZone): OrderStatus {
  return zone === 'ASUNCION' ? 'CONFIRMADO' : 'PENDIENTE_DE_PAGO';
}

/** Pedido aún abierto para operar desde el chat (no cerrado ni cancelado). */
export function isOpenOrder(status: OrderStatus): boolean {
  return status !== 'CERRADO' && status !== 'CANCELADO';
}

/** Cancelar solo si no hay pago confirmado y todavía no salió de viaje. */
export function canCancelOrder(status: OrderStatus, hasConfirmedPayment: boolean): boolean {
  if (hasConfirmedPayment) return false;
  return status === 'CONFIRMADO' || status === 'PENDIENTE_DE_PAGO' || status === 'LISTO_PARA_DESPACHO';
}

export function canEditOrderDetails(status: OrderStatus): boolean {
  return (
    status === 'CONFIRMADO' ||
    status === 'PENDIENTE_DE_PAGO' ||
    status === 'PAGO_CONFIRMADO' ||
    status === 'LISTO_PARA_DESPACHO'
  );
}

export function canEditCommercial(status: OrderStatus, hasConfirmedPayment: boolean): boolean {
  if (hasConfirmedPayment) return false;
  return status === 'CONFIRMADO' || status === 'PENDIENTE_DE_PAGO';
}

export function primaryActionFor(zone: OrderZone, status: OrderStatus): OrderAction | null {
  if (status === 'CERRADO' || status === 'CANCELADO') return null;
  if (status === 'ENTREGADO') return 'close';
  if (status === 'ENVIADO') return 'markDelivered';
  if (status === 'LISTO_PARA_DESPACHO') return 'markShipped';
  if (status === 'PAGO_CONFIRMADO') return 'markReady';
  if (status === 'PENDIENTE_DE_PAGO') return 'confirmPayment';
  if (status === 'CONFIRMADO') return zone === 'ASUNCION' ? 'markReady' : null;
  return null;
}

export function nextStatusForAction(action: OrderAction): OrderStatus {
  switch (action) {
    case 'confirmPayment':
      return 'PAGO_CONFIRMADO';
    case 'markReady':
      return 'LISTO_PARA_DESPACHO';
    case 'markShipped':
      return 'ENVIADO';
    case 'markDelivered':
      return 'ENTREGADO';
    case 'close':
      return 'CERRADO';
    case 'cancel':
      return 'CANCELADO';
  }
}

export function assertOrderTransition(input: {
  zone: OrderZone;
  status: OrderStatus;
  action: OrderAction;
  hasConfirmedPayment: boolean;
}): void {
  if (input.action === 'cancel') {
    if (!canCancelOrder(input.status, input.hasConfirmedPayment)) {
      throw new Error('Solo se puede cancelar un pedido que aún no se pagó y no se envió');
    }
    return;
  }

  const expected = primaryActionFor(input.zone, input.status);
  if (!expected || expected !== input.action) {
    throw new Error(`Transición inválida: ${input.status} no admite ${input.action}`);
  }

  if (input.action === 'confirmPayment' && input.zone !== 'INTERIOR') {
    throw new Error('El pago adelantado solo aplica a encomienda (Interior)');
  }

  if (input.action === 'markReady' && input.zone === 'INTERIOR' && !input.hasConfirmedPayment) {
    throw new Error('No despachar por encomienda sin pago adelantado confirmado');
  }
}
