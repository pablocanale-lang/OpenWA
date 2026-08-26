import { formatPyg } from './order-pricing.js';

export const DEFAULT_SALES_GROUP_NAME = 'Kampro Ventas';

export type SalesNotifyLine = {
  sku: string;
  productName: string;
  quantity: number;
  lineTotal: number;
};

export type SalesNotifyOrder = {
  id: string;
  recipientName: string;
  invoiceName: string;
  customerPhone: string;
  ruc: string;
  zone: 'ASUNCION' | 'INTERIOR';
  totalAmount: number;
  items: SalesNotifyLine[];
  locationText?: string | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: 'EFECTIVO' | 'TRANSFERENCIA' | null;
  city?: string | null;
  carrier?: string | null;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('es-PY', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(date);
}

export function formatSalesNotifyMessage(order: SalesNotifyOrder): string {
  const products =
    order.items.length > 0
      ? order.items.map((line) => `• ${line.sku} ${line.productName} × ${line.quantity} — ${formatPyg(line.lineTotal)}`).join('\n')
      : '• (sin líneas)';

  const delivery =
    order.zone === 'ASUNCION'
      ? [
          'Zona: Asunción (delivery)',
          `Ubicación: ${order.locationText?.trim() || '—'}`,
          `Horario: ${formatWhen(order.preferredTime)}`,
          `Pago: ${order.paymentMethodPreferred === 'TRANSFERENCIA' ? 'Transferencia' : 'Efectivo'}`,
        ]
      : [
          'Zona: Interior (encomienda)',
          `Ciudad: ${order.city?.trim() || '—'}`,
          `Transportadora: ${order.carrier?.trim() || '—'}`,
        ];

  return [
    '🛒 Pedido enviado',
    `Quien recibe: ${order.recipientName}`,
    `Factura: ${order.invoiceName}`,
    `Tel: ${order.customerPhone}`,
    `RUC: ${order.ruc}`,
    '',
    'Productos:',
    products,
    `Total: ${formatPyg(order.totalAmount)}`,
    '',
    ...delivery,
  ].join('\n');
}
