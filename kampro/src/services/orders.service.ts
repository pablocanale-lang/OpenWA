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
  initialStatusForZone,
  nextStatusForAction,
  primaryActionFor,
  type OrderAction,
  type OrderStatus as DomainStatus,
  type OrderZone as DomainZone,
} from '../domain/order-transitions.js';
import { resolveOrderLines, summarizeLines, type OrderLineInput } from './order-lines.js';
import { notifySalesGroup, type SalesNotifyResult } from './openwa.service.js';

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

function hasConfirmedPayment(payments: Array<{ status: PaymentStatus }>): boolean {
  return payments.some((p) => p.status === PaymentStatus.CONFIRMADO);
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

  const created = await prisma.order.create({
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

  return present(created);
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
};

export async function updateOrder(id: string, input: UpdateOrderInput) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) notFound('Pedido');

  const status = asStatus(order.status);
  const confirmed = hasConfirmedPayment(order.payments);
  if (!canEditOrderDetails(status)) badRequest('Este pedido ya no admite cambios de datos');

  const commercial =
    input.items !== undefined ||
    input.sku !== undefined ||
    input.quantity !== undefined ||
    input.discountApplied !== undefined ||
    input.totalAmount !== undefined;
  if (commercial && !canEditCommercial(status, confirmed)) {
    badRequest('SKU, cantidad y monto solo se editan si el pedido aún no se pagó');
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

    return tx.order.update({
      where: { id },
      data: { status: next as OrderStatus },
      include: orderInclude,
    });
  });

  let salesNotify: SalesNotifyResult | undefined;
  if (action === 'markShipped') {
    salesNotify = await notifySalesGroup({
      ...updated,
      items: presentItems(updated),
    });
    if (!salesNotify.ok) {
      console.warn(`[kampro] aviso al grupo de ventas falló: ${salesNotify.error}`);
    }
  }

  return present(updated, { salesNotify });
}
