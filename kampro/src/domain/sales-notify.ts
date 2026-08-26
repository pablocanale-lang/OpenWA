import { formatPyg } from './order-pricing.js';

export const DEFAULT_SALES_GROUP_NAME = 'Kampro Ventas';

export type SalesNotifyEvent = 'created' | 'paid';

export type SalesNotifyLine = {
  sku: string;
  productName: string;
  quantity: number;
  unitPricePyg?: number;
  discountApplied?: number;
  lineTotal: number;
};

export type SalesNotifyPayment = {
  amount: number;
  method: 'EFECTIVO' | 'TRANSFERENCIA';
  reference?: string | null;
  paidAt?: string | Date | null;
};

export type SalesNotifyOrder = {
  id: string;
  event?: SalesNotifyEvent;
  recipientName: string;
  invoiceName: string;
  customerPhone: string;
  contactName?: string | null;
  ruc: string;
  zone: 'ASUNCION' | 'INTERIOR';
  totalAmount: number;
  items: SalesNotifyLine[];
  locationText?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: 'EFECTIVO' | 'TRANSFERENCIA' | null;
  city?: string | null;
  carrier?: string | null;
  payments?: SalesNotifyPayment[];
};

function formatWhen(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('es-PY', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

function payLabel(method?: 'EFECTIVO' | 'TRANSFERENCIA' | null): string {
  if (method === 'TRANSFERENCIA') return 'Transferencia';
  if (method === 'EFECTIVO') return 'Efectivo';
  return '—';
}

function headline(order: SalesNotifyOrder): string {
  if (order.event === 'paid' || order.zone === 'INTERIOR') {
    return '💰 Pago confirmado — Interior (encomienda)';
  }
  return '🛒 Pedido nuevo — Asunción (delivery)';
}

export function formatSalesNotifyMessage(order: SalesNotifyOrder): string {
  const products =
    order.items.length > 0
      ? order.items
          .map((line) => {
            const unit = line.unitPricePyg != null ? ` @ ${formatPyg(line.unitPricePyg)}` : '';
            const disc = line.discountApplied ? ` (−${line.discountApplied}%)` : '';
            return `• ${line.sku} ${line.productName} × ${line.quantity}${unit}${disc} = ${formatPyg(line.lineTotal)}`;
          })
          .join('\n')
      : '• (sin líneas)';

  const lastPay = order.payments?.[0];
  const delivery =
    order.zone === 'ASUNCION'
      ? [
          'Zona: Asunción (delivery / contraentrega)',
          `Ubicación: ${order.locationText?.trim() || '—'}`,
          order.locationLat != null && order.locationLng != null
            ? `Coords: ${order.locationLat}, ${order.locationLng}`
            : null,
          `Horario: ${formatWhen(order.preferredTime)}`,
          `Medio de pago: ${payLabel(order.paymentMethodPreferred)}`,
        ]
      : [
          'Zona: Interior (encomienda)',
          `Ciudad: ${order.city?.trim() || '—'}`,
          `Transportadora: ${order.carrier?.trim() || '—'}`,
          lastPay
            ? `Pago: ${formatPyg(lastPay.amount)} · ${payLabel(lastPay.method)} · ${formatWhen(lastPay.paidAt)}`
            : 'Pago: confirmado',
          lastPay?.reference ? `Comprobante: ${lastPay.reference}` : null,
        ];

  return [
    headline(order),
    `Pedido: ${order.id}`,
    `Quien recibe: ${order.recipientName}`,
    `Factura: ${order.invoiceName}`,
    order.contactName ? `Contacto: ${order.contactName}` : null,
    `Tel: ${order.customerPhone}`,
    `RUC: ${order.ruc}`,
    '',
    'Productos:',
    products,
    `Total: ${formatPyg(order.totalAmount)}`,
    '',
    ...delivery.filter((line): line is string => Boolean(line)),
  ]
    .filter((line) => line !== null)
    .join('\n');
}
