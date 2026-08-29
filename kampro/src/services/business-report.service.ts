import { prisma } from '../db.js';
import { asString } from '../money.js';
import {
  aggregatePeriod,
  BUSINESS_PERIODS,
  deltaPct,
  goalProgress,
  importSpendInRange,
  inDateKeyRange,
  isClosedLostStatus,
  isOpenPipelineStatus,
  periodRange,
  previousPeriodRange,
  targetForPeriod,
  unpaidBalance,
  asuncionDateKey,
  type BusinessPeriod,
  type ConfirmedPaymentInput,
  type FirstPaidByPhone,
} from '../domain/business-report.js';
import { badRequest } from '../http-error.js';

export function parsePeriod(raw: unknown): BusinessPeriod {
  const value = typeof raw === 'string' ? raw : 'month';
  if (!BUSINESS_PERIODS.includes(value as BusinessPeriod)) {
    badRequest('Período inválido. Usá day, week, month o year.');
  }
  return value as BusinessPeriod;
}

export async function businessReport(period: BusinessPeriod, now = new Date()) {
  const range = periodRange(period, now);
  const previous = previousPeriodRange(period, range);

  const [payments, orders, products, purchaseOrders, followUpCount, targetsRow] = await Promise.all([
    prisma.payment.findMany({
      where: { status: 'CONFIRMADO' },
      include: {
        order: {
          select: {
            id: true,
            customerPhone: true,
            zone: true,
            status: true,
            sku: true,
            productName: true,
            quantity: true,
            totalAmount: true,
            items: { select: { sku: true, productName: true, quantity: true, lineTotal: true } },
          },
        },
      },
      orderBy: { paidAt: 'asc' },
    }),
    prisma.order.findMany({
      include: { payments: true },
    }),
    prisma.product.findMany({ orderBy: { sku: 'asc' } }),
    prisma.purchaseOrder.findMany(),
    prisma.chatFollowUp.count(),
    prisma.salesTarget.findUnique({ where: { id: 'default' } }),
  ]);

  const firstPaidByPhone: FirstPaidByPhone = {};
  for (const payment of payments) {
    const phone = payment.order.customerPhone;
    if (!firstPaidByPhone[phone]) firstPaidByPhone[phone] = asuncionDateKey(payment.paidAt);
  }

  const mapped: ConfirmedPaymentInput[] = payments
    .filter((p) => !isClosedLostStatus(p.order.status))
    .map((p) => ({
      paidAt: p.paidAt,
      amount: p.amount,
      method: p.method,
      phone: p.order.customerPhone,
      zone: p.order.zone,
      orderId: p.order.id,
      lines:
        p.order.items.length > 0
          ? p.order.items.map((line) => ({
              sku: line.sku,
              name: line.productName,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            }))
          : [
              {
                sku: p.order.sku,
                name: p.order.productName,
                quantity: p.order.quantity,
                lineTotal: p.order.totalAmount,
              },
            ],
    }));

  const current = aggregatePeriod(mapped, firstPaidByPhone, range.fromKey, range.toKey);
  const prev = aggregatePeriod(mapped, firstPaidByPhone, previous.fromKey, previous.toKey);

  const pipeline: Record<string, number> = {};
  let invoicesIssued = 0;
  let pendingCount = 0;
  let pendingPyg = 0;
  let pendingDelivery = 0;
  let pendingEncomienda = 0;

  for (const order of orders) {
    if (isOpenPipelineStatus(order.status)) {
      pipeline[order.status] = (pipeline[order.status] ?? 0) + 1;
    }
    if (order.invoiceIssuedAt && inDateKeyRange(order.invoiceIssuedAt, range.fromKey, range.toKey)) {
      invoicesIssued += 1;
    }
    if (isClosedLostStatus(order.status)) continue;
    const paid = order.payments.filter((p) => p.status === 'CONFIRMADO').reduce((s, p) => s + p.amount, 0);
    const due = unpaidBalance(order.totalAmount, paid);
    if (due <= 0) continue;
    pendingCount += 1;
    pendingPyg += due;
    if (order.zone === 'ASUNCION') pendingDelivery += due;
    else pendingEncomienda += due;
  }

  let importSpentPyg = 0;
  let importMissingFx = false;
  for (const po of purchaseOrders) {
    const row = importSpendInRange(
      {
        status: po.status,
        confirmedAt: po.confirmedAt,
        closedAt: po.closedAt,
        quantity: po.quantity,
        unitPrice: asString(po.unitPrice) ?? '0',
        freight: asString(po.freight),
        otherCharges: asString(po.otherCharges),
        customsCost: asString(po.customsCost),
        dispatchCost: asString(po.dispatchCost),
        fxRateToPyg: asString(po.fxRateToPyg),
        currency: po.currency,
      },
      range.fromKey,
      range.toKey,
    );
    importSpentPyg += row.pyg;
    if (row.missingFx) importMissingFx = true;
  }

  const targets = {
    dayPyg: targetsRow?.dayPyg ?? null,
    weekPyg: targetsRow?.weekPyg ?? null,
    monthPyg: targetsRow?.monthPyg ?? null,
    yearPyg: targetsRow?.yearPyg ?? null,
  };
  const targetPyg = targetForPeriod(period, targets);
  const goal = goalProgress(current.revenuePyg, targetPyg);

  return {
    period,
    timezone: 'America/Asuncion',
    range,
    previousRange: previous,
    revenuePyg: current.revenuePyg,
    previousRevenuePyg: prev.revenuePyg,
    revenueDeltaPct: deltaPct(current.revenuePyg, prev.revenuePyg),
    paidOrderCount: current.paidOrderCount,
    previousPaidOrderCount: prev.paidOrderCount,
    unitsSold: current.unitsSold,
    previousUnitsSold: prev.unitsSold,
    avgTicketPyg: current.avgTicketPyg,
    byProduct: current.byProduct,
    byZone: current.byZone,
    byMethod: current.byMethod,
    customers: current.customers,
    series: current.series,
    pipeline,
    invoicesIssued,
    pendingCollection: {
      count: pendingCount,
      amountPyg: pendingPyg,
      deliveryPyg: pendingDelivery,
      encomiendaPyg: pendingEncomienda,
    },
    stock: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      stockQty: p.stockQty,
      unitPricePyg: p.unitPricePyg,
    })),
    importSpend: {
      pyg: importSpentPyg,
      missingFx: importMissingFx,
    },
    followUpChats: followUpCount,
    targets,
    targetPyg,
    goalPct: goal.pct,
    goalRemainingPyg: goal.remaining,
    notes: [
      'Los ingresos cuentan pagos confirmados. Pedidos sin cobro no suman.',
      'Cliente nuevo: primer pago confirmado en el período. Recurrente: ya había pagado antes.',
      'Unidades por SKU se cuentan una vez por pedido (primer cobro del período).',
    ],
  };
}

export async function getSalesTargets() {
  const row = await prisma.salesTarget.findUnique({ where: { id: 'default' } });
  return {
    dayPyg: row?.dayPyg ?? null,
    weekPyg: row?.weekPyg ?? null,
    monthPyg: row?.monthPyg ?? null,
    yearPyg: row?.yearPyg ?? null,
  };
}

export async function saveSalesTargets(body: {
  dayPyg?: number | null;
  weekPyg?: number | null;
  monthPyg?: number | null;
  yearPyg?: number | null;
}) {
  const current = await getSalesTargets();
  const data = {
    dayPyg: body.dayPyg !== undefined ? body.dayPyg : current.dayPyg,
    weekPyg: body.weekPyg !== undefined ? body.weekPyg : current.weekPyg,
    monthPyg: body.monthPyg !== undefined ? body.monthPyg : current.monthPyg,
    yearPyg: body.yearPyg !== undefined ? body.yearPyg : current.yearPyg,
  };
  await prisma.salesTarget.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  });
  return getSalesTargets();
}
