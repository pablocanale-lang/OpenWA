import {
  OrderStatus,
  OrderZone,
  PaymentMethod,
  PaymentStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../http-error.js';
import { assertPreferredDateTime, assertRuc } from '../domain/order-fields.js';
import {
  assertOrderTransition,
  canCancelOrder,
  canEditCommercial,
  canEditOrderDetails,
  canEditShippingCost,
  canReturnOrder,
  initialStatusForZone,
  isTerminalOrder,
  nextStatusForAction,
  primaryActionFor,
  type OrderAction,
  type OrderStatus as DomainStatus,
  type OrderZone as DomainZone,
} from '../domain/order-transitions.js';
import { resolveOrderLines, summarizeLines, type OrderLineInput } from './order-lines.js';
import { notifySalesGroup, type SalesNotifyResult } from './openwa.service.js';
import { applyOrderStock, restoreOrderStock } from './stock.service.js';
import { allocateInvoice } from './invoice.service.js';

const orderInclude = {
  payments: { orderBy: { paidAt: 'desc' as const } },
  items: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function asZone(zone: OrderZone): DomainZone {
  return zone;
}

function asStatus(status: OrderStatus): DomainStatus {
  return status;
}

function netPaidAmount(payments: Array<{ status: PaymentStatus; amount: number }>): number {
  let total = 0;
  for (const payment of payments) {
    if (payment.status === PaymentStatus.CONFIRMADO) total += payment.amount;
    if (payment.status === PaymentStatus.REEMBOLSADO) total -= payment.amount;
  }
  return total;
}

function hasConfirmedPayment(payments: Array<{ status: PaymentStatus; amount: number }>): boolean {
  return netPaidAmount(payments) > 0;
}

async function refundConfirmedPayments(
  tx: Prisma.TransactionClient,
  orderId: string,
  payments: Array<{ status: PaymentStatus; amount: number; method: PaymentMethod }>,
) {
  const net = netPaidAmount(payments);
  if (net < 1) return;
  const last = payments.find((p) => p.status === PaymentStatus.CONFIRMADO);
  await tx.payment.create({
    data: {
      orderId,
      amount: Math.round(net),
      method: last?.method ?? PaymentMethod.TRANSFERENCIA,
      paidAt: new Date(),
      status: PaymentStatus.REEMBOLSADO,
      reference: 'Reembolso',
    },
  });
}

function shouldIssueInvoice(zone: OrderZone, action: OrderAction, invoiceNumber: string | null): boolean {
  if (invoiceNumber) return false;
  if (action === 'confirmPayment' && zone === OrderZone.INTERIOR) return true;
  if (action === 'markDelivered' && zone === OrderZone.ASUNCION) return true;
  return false;
}

const INTERIOR_INVOICE_STATUSES: DomainStatus[] = [
  'PAGO_CONFIRMADO',
  'LISTO_PARA_DESPACHO',
  'ENVIADO',
  'ENTREGADO',
  'CERRADO',
];

function shouldIssueInvoiceForStatus(
  zone: OrderZone,
  status: DomainStatus,
  invoiceNumber: string | null,
  hasPayment: boolean,
): boolean {
  if (invoiceNumber) return false;
  if (zone === OrderZone.INTERIOR) {
    return hasPayment && INTERIOR_INVOICE_STATUSES.includes(status);
  }
  return status === 'ENTREGADO' || status === 'CERRADO';
}

function presentItems(order: OrderRow) {
  if (order.items.length > 0) return order.items;
  return [
    {
      id: `${order.id}-legacy`,
      orderId: order.id,
      sku: order.sku,
      productName: order.productName,
      quantity: order.quantity,
      unitPricePyg:
        order.quantity > 0
          ? Math.round(order.totalAmount / (order.quantity * (1 - order.discountApplied / 100) || 1))
          : 0,
      discountApplied: order.discountApplied,
      lineTotal: order.totalAmount,
      sortOrder: 0,
      createdAt: order.createdAt,
    },
  ];
}

function present(order: OrderRow, extra?: { salesNotify?: SalesNotifyResult }) {
  const confirmed = hasConfirmedPayment(order.payments);
  const status = asStatus(order.status);
  return {
    ...order,
    items: presentItems(order),
    primaryAction: primaryActionFor(asZone(order.zone), status),
    canCancel: canCancelOrder(status, confirmed),
    canReturn: canReturnOrder(status, confirmed),
    canEditDetails: canEditOrderDetails(status),
    canEditCommercial: canEditCommercial(status, confirmed),
    canEditShipping: canEditShippingCost(status),
    netPaid: netPaidAmount(order.payments),
    ...(extra?.salesNotify ? { salesNotify: extra.salesNotify } : {}),
  };
}

export async function listOrders(filters?: { phone?: string; chatId?: string }) {
  const ors: Prisma.OrderWhereInput[] = [];
  if (filters?.phone?.trim()) ors.push({ customerPhone: filters.phone.trim() });
  if (filters?.chatId?.trim()) ors.push({ chatId: filters.chatId.trim() });

  const orders = await prisma.order.findMany({
    where: ors.length === 0 ? undefined : ors.length === 1 ? ors[0] : { OR: ors },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });
  return orders.map((order) => present(order));
}

export async function getOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) notFound('Pedido');
  return present(order);
}

export type CreateOrderInput = {
  items?: OrderLineInput[];
  sku?: string;
  quantity?: number;
  discountApplied?: number;
  totalAmount?: number;
  zone: OrderZone;
  customerPhone: string;
  contactName?: string;
  recipientName: string;
  invoiceName: string;
  ruc: string;
  sessionId?: string;
  chatId?: string;
  locationLat?: number | null;
  locationLng?: number | null;
  locationText?: string | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: PaymentMethod | null;
  city?: string | null;
  carrier?: string | null;
};

export async function createOrder(input: CreateOrderInput) {
  const lines = await resolveOrderLines(input);
  const summary = summarizeLines(lines);
  const ruc = assertRuc(input.ruc);

  let preferredTime: string | null = null;
  if (input.zone === OrderZone.ASUNCION) {
    if (!input.locationText?.trim()) badRequest('Ubicación en Maps es obligatoria para Asunción');
    if (!input.preferredTime?.trim()) badRequest('Horario de preferencia es obligatorio para Asunción');
    preferredTime = assertPreferredDateTime(input.preferredTime);
    if (!input.paymentMethodPreferred) badRequest('Medio de pago es obligatorio para Asunción');
  } else {
    if (!input.city?.trim()) badRequest('Ciudad es obligatoria para Interior');
    if (!input.carrier?.trim()) badRequest('Transportadora es obligatoria para Interior');
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        sku: summary.sku,
        productName: summary.productName,
        quantity: summary.quantity,
        discountApplied: summary.discountApplied,
        totalAmount: summary.totalAmount,
        zone: input.zone,
        customerPhone: input.customerPhone.trim(),
        contactName: input.contactName?.trim() || null,
        recipientName: input.recipientName.trim(),
        invoiceName: input.invoiceName.trim(),
        ruc,
        status: initialStatusForZone(asZone(input.zone)),
        sessionId: input.sessionId || null,
        chatId: input.chatId || null,
        locationLat: input.zone === OrderZone.ASUNCION ? (input.locationLat ?? null) : null,
        locationLng: input.zone === OrderZone.ASUNCION ? (input.locationLng ?? null) : null,
        locationText: input.zone === OrderZone.ASUNCION ? input.locationText!.trim() : null,
        preferredTime,
        paymentMethodPreferred: input.zone === OrderZone.ASUNCION ? input.paymentMethodPreferred! : null,
        city: input.zone === OrderZone.INTERIOR ? input.city!.trim() : null,
        carrier: input.zone === OrderZone.INTERIOR ? input.carrier!.trim() : null,
        items: {
          create: lines.map((line) => ({
            sku: line.sku,
            productName: line.productName,
            quantity: line.quantity,
            unitPricePyg: line.unitPricePyg,
            discountApplied: line.discountApplied,
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder,
          })),
        },
      },
      include: orderInclude,
    });
    await applyOrderStock(tx, order.id, lines);
    return order;
  });

  let salesNotify: SalesNotifyResult | undefined;
  if (input.zone === OrderZone.ASUNCION) {
    salesNotify = await notifySalesGroup({
      ...created,
      items: presentItems(created),
      event: 'created',
    });
    if (!salesNotify.ok) {
      console.warn(`[kampro] aviso al grupo de ventas falló: ${salesNotify.error}`);
    }
  }

  return present(created, { salesNotify });
}

export type UpdateOrderInput = {
  items?: OrderLineInput[];
  sku?: string;
  quantity?: number;
  discountApplied?: number;
  totalAmount?: number;
  contactName?: string | null;
  recipientName?: string;
  invoiceName?: string;
  ruc?: string;
  locationLat?: number | null;
  locationLng?: number | null;
  locationText?: string | null;
  preferredTime?: string | null;
  paymentMethodPreferred?: PaymentMethod | null;
  city?: string | null;
  carrier?: string | null;
  shippingCostPyg?: number | null;
};

function isShippingOnlyPatch(input: UpdateOrderInput): boolean {
  return Object.entries(input).every(([key, value]) => value === undefined || key === 'shippingCostPyg');
}

export async function updateShippingCost(id: string, shippingCostPyg: number | null) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) notFound('Pedido');
  if (!canEditShippingCost(asStatus(order.status))) {
    badRequest('El costo de envío se carga desde Enviado hasta Cerrado');
  }
  const next =
    shippingCostPyg == null ? null : Math.max(0, Math.round(shippingCostPyg));
  const updated = await prisma.order.update({
    where: { id },
    data: { shippingCostPyg: next },
    include: orderInclude,
  });
  return present(updated);
}

export async function updateOrder(id: string, input: UpdateOrderInput) {
  if (input.shippingCostPyg !== undefined && isShippingOnlyPatch(input)) {
    return updateShippingCost(id, input.shippingCostPyg);
  }

  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) notFound('Pedido');

  const status = asStatus(order.status);
  const confirmed = hasConfirmedPayment(order.payments);
  if (!canEditOrderDetails(status)) badRequest('Este pedido ya no admite cambios de datos');
  if (input.shippingCostPyg !== undefined && !canEditShippingCost(status)) {
    badRequest('El costo de envío se carga desde Enviado hasta Cerrado');
  }

  const commercial =
    input.items !== undefined ||
    input.sku !== undefined ||
    input.quantity !== undefined ||
    input.discountApplied !== undefined ||
    input.totalAmount !== undefined;
  if (commercial && !canEditCommercial(status, confirmed)) {
    badRequest('Este pedido ya no admite cambios de productos');
  }

  const nextZone = order.zone;
  const locationText = (input.locationText !== undefined ? input.locationText : order.locationText)?.trim() || '';
  const payMethod =
    input.paymentMethodPreferred !== undefined ? input.paymentMethodPreferred : order.paymentMethodPreferred;
  const city = (input.city !== undefined ? input.city : order.city)?.trim() || '';
  const carrier = (input.carrier !== undefined ? input.carrier : order.carrier)?.trim() || '';

  let preferredTime = order.preferredTime;
  if (nextZone === OrderZone.ASUNCION) {
    if (!locationText) badRequest('Ubicación en Maps es obligatoria para Asunción');
    const rawTime = input.preferredTime !== undefined ? input.preferredTime : order.preferredTime;
    if (!rawTime?.trim()) badRequest('Horario de preferencia es obligatorio para Asunción');
    preferredTime = assertPreferredDateTime(rawTime);
    if (!payMethod) badRequest('Medio de pago es obligatorio para Asunción');
  } else {
    if (!city) badRequest('Ciudad es obligatoria para Interior');
    if (!carrier) badRequest('Transportadora es obligatoria para Interior');
    preferredTime = null;
  }

  const recipientName = input.recipientName !== undefined ? input.recipientName.trim() : order.recipientName;
  const invoiceName = input.invoiceName !== undefined ? input.invoiceName.trim() : order.invoiceName;
  const ruc = input.ruc !== undefined ? assertRuc(input.ruc) : order.ruc;
  if (!recipientName) badRequest('Nombre de quien recibe es obligatorio');
  if (!invoiceName) badRequest('Nombre para factura es obligatorio');

  const lines = commercial
    ? await resolveOrderLines(
        input.items
          ? { items: input.items }
          : {
              sku: input.sku ?? order.sku.split(',')[0]?.trim(),
              quantity: input.quantity,
              discountApplied: input.discountApplied,
            },
      )
    : null;
  const summary = lines ? summarizeLines(lines) : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await tx.orderLine.createMany({
        data: lines.map((line) => ({
          orderId: id,
          sku: line.sku,
          productName: line.productName,
          quantity: line.quantity,
          unitPricePyg: line.unitPricePyg,
          discountApplied: line.discountApplied,
          lineTotal: line.lineTotal,
          sortOrder: line.sortOrder,
        })),
      });
      await applyOrderStock(tx, id, lines);
    }

    return tx.order.update({
      where: { id },
      data: {
        sku: summary?.sku,
        productName: summary?.productName,
        quantity: summary?.quantity,
        discountApplied: summary?.discountApplied,
        totalAmount: summary?.totalAmount,
        contactName:
          input.contactName !== undefined ? input.contactName?.trim() || null : undefined,
        recipientName,
        invoiceName,
        ruc,
        locationLat:
          nextZone === OrderZone.ASUNCION
            ? input.locationLat !== undefined
              ? input.locationLat
              : undefined
            : null,
        locationLng:
          nextZone === OrderZone.ASUNCION
            ? input.locationLng !== undefined
              ? input.locationLng
              : undefined
            : null,
        locationText: nextZone === OrderZone.ASUNCION ? locationText : null,
        preferredTime: nextZone === OrderZone.ASUNCION ? preferredTime : null,
        paymentMethodPreferred: nextZone === OrderZone.ASUNCION ? payMethod : null,
        city: nextZone === OrderZone.INTERIOR ? city : null,
        carrier: nextZone === OrderZone.INTERIOR ? carrier : null,
        shippingCostPyg:
          input.shippingCostPyg !== undefined
            ? input.shippingCostPyg == null
              ? null
              : Math.max(0, Math.round(input.shippingCostPyg))
            : undefined,
      },
      include: orderInclude,
    });
  });

  return present(updated);
}

export type PaymentInput = {
  amount: number;
  method: PaymentMethod;
  paidAt: Date;
  reference?: string | null;
};

export async function transitionOrder(id: string, action: OrderAction, payment?: PaymentInput) {
  const order = await getOrder(id);
  const confirmed = hasConfirmedPayment(order.payments);

  try {
    assertOrderTransition({
      zone: asZone(order.zone),
      status: asStatus(order.status),
      action,
      hasConfirmedPayment: confirmed,
    });
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Transición inválida');
  }

  const needsPayment = action === 'confirmPayment' || (action === 'markDelivered' && order.zone === OrderZone.ASUNCION);
  if (needsPayment) {
    if (!payment) badRequest('Hay que registrar el cobro');
    if (payment.amount < 1) badRequest('El monto del pago debe ser mayor a 0');
  }

  const next = nextStatusForAction(action);

  const updated = await prisma.$transaction(async (tx) => {
    if (needsPayment && payment) {
      await tx.payment.create({
        data: {
          orderId: id,
          amount: Math.round(payment.amount),
          method: payment.method,
          paidAt: payment.paidAt,
          status: PaymentStatus.CONFIRMADO,
          reference: payment.reference?.trim() || null,
        },
      });
    }

    if (action === 'cancel') {
      await restoreOrderStock(tx, id, 'CANCELACION_PEDIDO');
      if (confirmed) await refundConfirmedPayments(tx, id, order.payments);
    }
    if (action === 'returnOrder') {
      await restoreOrderStock(tx, id, 'DEVOLUCION');
      if (confirmed) await refundConfirmedPayments(tx, id, order.payments);
    }

    const invoice = shouldIssueInvoice(order.zone, action, order.invoiceNumber)
      ? await allocateInvoice(tx)
      : null;

    return tx.order.update({
      where: { id },
      data: {
        status: next as OrderStatus,
        ...(invoice
          ? {
              invoiceNumber: invoice.invoiceNumber,
              invoiceIssuer: invoice.invoiceIssuer,
              invoiceIssuedAt: invoice.invoiceIssuedAt,
            }
          : {}),
      },
      include: orderInclude,
    });
  });

  let salesNotify: SalesNotifyResult | undefined;
  if (action === 'confirmPayment' && order.zone === OrderZone.INTERIOR) {
    salesNotify = await notifySalesGroup({
      ...updated,
      items: presentItems(updated),
      event: 'paid',
      payments: updated.payments.map((p) => ({
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        paidAt: p.paidAt,
      })),
    });
    if (!salesNotify.ok) {
      console.warn(`[kampro] aviso al grupo de ventas falló: ${salesNotify.error}`);
    }
  }

  return present(updated, { salesNotify });
}

export async function setOrderStatus(id: string, next: OrderStatus) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) notFound('Pedido');
  const current = asStatus(order.status);
  const target = asStatus(next);
  if (current === target) return present(order);

  const confirmed = hasConfirmedPayment(order.payments);
  const updated = await prisma.$transaction(async (tx) => {
    if (!isTerminalOrder(current) && isTerminalOrder(target)) {
      await restoreOrderStock(tx, id, target === 'DEVUELTO' ? 'DEVOLUCION' : 'CANCELACION_PEDIDO');
      if (confirmed) await refundConfirmedPayments(tx, id, order.payments);
    }
    if (isTerminalOrder(current) && !isTerminalOrder(target)) {
      await applyOrderStock(tx, id, presentItems(order));
    }
    const invoice = shouldIssueInvoiceForStatus(order.zone, target, order.invoiceNumber, confirmed)
      ? await allocateInvoice(tx)
      : null;
    return tx.order.update({
      where: { id },
      data: {
        status: next,
        ...(invoice
          ? {
              invoiceNumber: invoice.invoiceNumber,
              invoiceIssuer: invoice.invoiceIssuer,
              invoiceIssuedAt: invoice.invoiceIssuedAt,
            }
          : {}),
      },
      include: orderInclude,
    });
  });
  return present(updated);
}
