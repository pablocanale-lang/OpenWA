export const ORDER_STATUSES = [
  'CONFIRMADO',
  'PENDIENTE_DE_PAGO',
  'PAGO_CONFIRMADO',
  'LISTO_PARA_DESPACHO',
  'ENVIADO',
  'ENTREGADO',
  'CERRADO',
  'CANCELADO',
  'DEVUELTO',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderZone = 'ASUNCION' | 'INTERIOR';
export type OrderAction =
  | 'confirmPayment'
  | 'markReady'
  | 'markShipped'
  | 'markDelivered'
  | 'close'
  | 'cancel'
  | 'returnOrder';

export function initialStatusForZone(zone: OrderZone): OrderStatus {
  return zone === 'ASUNCION' ? 'CONFIRMADO' : 'PENDIENTE_DE_PAGO';
}

/** Pedido aún abierto para operar desde el chat (no cerrado ni cancelado). */
export function isOpenOrder(status: OrderStatus): boolean {
  return status !== 'CERRADO' && status !== 'CANCELADO' && status !== 'DEVUELTO';
}

export function isTerminalOrder(status: OrderStatus): boolean {
  return status === 'CANCELADO' || status === 'DEVUELTO';
}

/** Cancelar en cualquier etapa, salvo que ya esté cancelado o devuelto. */
export function canCancelOrder(status: OrderStatus, _hasConfirmedPayment: boolean): boolean {
  return !isTerminalOrder(status);
}

/** Reembolso en cualquier etapa si hubo cobro (o siempre si no está terminal). */
export function canReturnOrder(status: OrderStatus, hasConfirmedPayment: boolean): boolean {
  if (isTerminalOrder(status)) return false;
  return hasConfirmedPayment;
}

/** Datos del pedido editables en cualquier etapa no terminal. */
export function canEditOrderDetails(status: OrderStatus): boolean {
  return !isTerminalOrder(status);
}

export function canEditCommercial(status: OrderStatus, _hasConfirmedPayment: boolean): boolean {
  return !isTerminalOrder(status);
}

export function canEditShippingCost(status: OrderStatus): boolean {
  return status === 'ENVIADO' || status === 'ENTREGADO' || status === 'CERRADO';
}

/** Cerrar exige el flete de Kampro ya cargado (0 vale: se cargó “sin gasto”). */
export function assertShippingLoadedForClose(shippingCostPyg: number | null | undefined): asserts shippingCostPyg is number {
  if (shippingCostPyg == null || !Number.isFinite(shippingCostPyg) || shippingCostPyg < 0) {
    throw new Error('Para cerrar el pedido hay que cargar el costo de envío');
  }
}

export function primaryActionFor(zone: OrderZone, status: OrderStatus): OrderAction | null {
  if (status === 'CERRADO' || status === 'CANCELADO' || status === 'DEVUELTO') return null;
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
    case 'returnOrder':
      return 'DEVUELTO';
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
      throw new Error('Este pedido ya está cancelado o devuelto');
    }
    return;
  }

  if (input.action === 'returnOrder') {
    if (!canReturnOrder(input.status, input.hasConfirmedPayment)) {
      throw new Error('Solo se puede reembolsar un pedido que ya tiene un cobro confirmado');
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
