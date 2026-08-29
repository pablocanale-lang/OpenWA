import { chinaCostFromMerchandise, merchandiseTotal, type PurchaseOrderStatus } from './purchase-orders.js';

export const BUSINESS_TZ = 'America/Asuncion';
export const BUSINESS_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type BusinessPeriod = (typeof BUSINESS_PERIODS)[number];

export type DateKey = string;

export function asuncionDateKey(date: Date): DateKey {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(date);
}

export function parseDateKey(key: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function utcYmd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function keyFromUtc(date: Date): DateKey {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysKey(key: DateKey, days: number): DateKey {
  const { y, m, d } = parseDateKey(key);
  const next = utcYmd(y, m, d);
  next.setUTCDate(next.getUTCDate() + days);
  return keyFromUtc(next);
}

function mondayOnOrBefore(key: DateKey): DateKey {
  const { y, m, d } = parseDateKey(key);
  const dt = utcYmd(y, m, d);
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return keyFromUtc(dt);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function inDateKeyRange(date: Date, fromKey: DateKey, toKey: DateKey): boolean {
  const key = asuncionDateKey(date);
  return key >= fromKey && key <= toKey;
}

export function periodRange(period: BusinessPeriod, now: Date): { fromKey: DateKey; toKey: DateKey } {
  const today = asuncionDateKey(now);
  const { y, m, d } = parseDateKey(today);
  if (period === 'day') return { fromKey: today, toKey: today };
  if (period === 'week') {
    const fromKey = mondayOnOrBefore(today);
    return { fromKey, toKey: addDaysKey(fromKey, 6) };
  }
  if (period === 'month') {
    const fromKey = `${y}-${String(m).padStart(2, '0')}-01`;
    const toKey = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
    return { fromKey, toKey };
  }
  return { fromKey: `${y}-01-01`, toKey: `${y}-12-31` };
}

export function previousPeriodRange(
  period: BusinessPeriod,
  current: { fromKey: DateKey; toKey: DateKey },
): { fromKey: DateKey; toKey: DateKey } {
  if (period === 'day') {
    const fromKey = addDaysKey(current.fromKey, -1);
    return { fromKey, toKey: fromKey };
  }
  if (period === 'week') {
    const fromKey = addDaysKey(current.fromKey, -7);
    return { fromKey, toKey: addDaysKey(fromKey, 6) };
  }
  if (period === 'month') {
    const { y, m } = parseDateKey(current.fromKey);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const fromKey = `${prev.y}-${String(prev.m).padStart(2, '0')}-01`;
    const toKey = `${prev.y}-${String(prev.m).padStart(2, '0')}-${String(lastDayOfMonth(prev.y, prev.m)).padStart(2, '0')}`;
    return { fromKey, toKey };
  }
  const { y } = parseDateKey(current.fromKey);
  return { fromKey: `${y - 1}-01-01`, toKey: `${y - 1}-12-31` };
}

export function dateKeysInclusive(fromKey: DateKey, toKey: DateKey): DateKey[] {
  const keys: DateKey[] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    keys.push(cursor);
    cursor = addDaysKey(cursor, 1);
  }
  return keys;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function goalProgress(
  actual: number,
  target: number | null | undefined,
): { pct: number | null; remaining: number | null } {
  if (target == null || target <= 0) return { pct: null, remaining: null };
  return {
    pct: Math.round((actual / target) * 1000) / 10,
    remaining: Math.max(0, target - actual),
  };
}

export function targetForPeriod(
  period: BusinessPeriod,
  targets: { dayPyg: number | null; weekPyg: number | null; monthPyg: number | null; yearPyg: number | null },
): number | null {
  if (period === 'day') return targets.dayPyg;
  if (period === 'week') return targets.weekPyg;
  if (period === 'month') return targets.monthPyg;
  return targets.yearPyg;
}

export type CustomerKind = 'new' | 'returning';

export function classifyPhone(firstPaidKey: DateKey, fromKey: DateKey, toKey: DateKey): CustomerKind {
  if (firstPaidKey >= fromKey && firstPaidKey <= toKey) return 'new';
  return 'returning';
}

export type ConfirmedPaymentInput = {
  paidAt: Date;
  amount: number;
  method: 'EFECTIVO' | 'TRANSFERENCIA';
  phone: string;
  zone: 'ASUNCION' | 'INTERIOR';
  orderId: string;
  lines: Array<{ sku: string; name: string; quantity: number; lineTotal: number }>;
};

export type FirstPaidByPhone = Record<string, DateKey>;

export function unpaidBalance(totalAmount: number, confirmedPaid: number): number {
  return Math.max(0, totalAmount - confirmedPaid);
}

export function isClosedLostStatus(status: string): boolean {
  return status === 'CANCELADO' || status === 'DEVUELTO';
}

export function isOpenPipelineStatus(status: string): boolean {
  return !isClosedLostStatus(status) && status !== 'CERRADO';
}

export function importSpendInRange(
  po: {
    status: PurchaseOrderStatus;
    confirmedAt: Date | null;
    closedAt: Date | null;
    quantity: number;
    unitPrice: string | number;
    freight: string | number | null;
    otherCharges: string | number | null;
    customsCost: string | number | null;
    dispatchCost: string | number | null;
    fxRateToPyg: string | number | null;
    currency?: string | null;
    merchandiseTotal?: string | number | null;
  },
  fromKey: DateKey,
  toKey: DateKey,
): { pyg: number; missingFx: boolean } {
  if (po.status === 'BORRADOR' || po.status === 'CANCELADA') return { pyg: 0, missingFx: false };
  let pyg = 0;
  let missingFx = false;
  const merch =
    po.merchandiseTotal !== null && po.merchandiseTotal !== undefined && po.merchandiseTotal !== ''
      ? Number(po.merchandiseTotal)
      : merchandiseTotal(po.quantity, po.unitPrice);
  if (po.confirmedAt && inDateKeyRange(po.confirmedAt, fromKey, toKey)) {
    const china = chinaCostFromMerchandise(merch, po.freight, po.otherCharges, po.fxRateToPyg, po.currency);
    if (china == null) missingFx = true;
    else pyg += china;
  }
  if (po.status === 'CERRADA' && po.closedAt && inDateKeyRange(po.closedAt, fromKey, toKey)) {
    pyg += Number(po.customsCost || 0) + Number(po.dispatchCost || 0);
  }
  return { pyg, missingFx };
}

export function aggregatePeriod(
  payments: ConfirmedPaymentInput[],
  firstPaidByPhone: FirstPaidByPhone,
  fromKey: DateKey,
  toKey: DateKey,
) {
  const inPeriod = payments.filter((p) => inDateKeyRange(p.paidAt, fromKey, toKey));
  const revenuePyg = inPeriod.reduce((s, p) => s + p.amount, 0);
  const orderIds = new Set(inPeriod.map((p) => p.orderId));
  const paidOrderCount = orderIds.size;

  const byProduct = new Map<string, { sku: string; name: string; units: number; revenuePyg: number }>();
  const attributed = new Set<string>();
  let unitsSold = 0;
  const sorted = [...inPeriod].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  for (const p of sorted) {
    if (attributed.has(p.orderId)) continue;
    attributed.add(p.orderId);
    for (const line of p.lines) {
      unitsSold += line.quantity;
      const cur = byProduct.get(line.sku) ?? { sku: line.sku, name: line.name, units: 0, revenuePyg: 0 };
      cur.units += line.quantity;
      cur.revenuePyg += line.lineTotal;
      cur.name = line.name;
      byProduct.set(line.sku, cur);
    }
  }

  const byZone = {
    ASUNCION: { revenuePyg: 0, payments: 0 },
    INTERIOR: { revenuePyg: 0, payments: 0 },
  };
  const byMethod = {
    EFECTIVO: 0,
    TRANSFERENCIA: 0,
  };
  const seriesMap = new Map<DateKey, { revenuePyg: number; payments: number }>();
  for (const key of dateKeysInclusive(fromKey, toKey)) {
    seriesMap.set(key, { revenuePyg: 0, payments: 0 });
  }
  const phonesInPeriod = new Set<string>();
  const newPhones = new Set<string>();
  const returningPhones = new Set<string>();
  let newRevenuePyg = 0;
  let returningRevenuePyg = 0;

  for (const p of inPeriod) {
    byZone[p.zone].revenuePyg += p.amount;
    byZone[p.zone].payments += 1;
    byMethod[p.method] += p.amount;
    const day = asuncionDateKey(p.paidAt);
    const bucket = seriesMap.get(day);
    if (bucket) {
      bucket.revenuePyg += p.amount;
      bucket.payments += 1;
    }
    phonesInPeriod.add(p.phone);
    const firstKey = firstPaidByPhone[p.phone] ?? day;
    const kind = classifyPhone(firstKey, fromKey, toKey);
    if (kind === 'new') {
      newPhones.add(p.phone);
      newRevenuePyg += p.amount;
    } else {
      returningPhones.add(p.phone);
      returningRevenuePyg += p.amount;
    }
  }

  return {
    revenuePyg,
    paidOrderCount,
    unitsSold,
    avgTicketPyg: paidOrderCount > 0 ? Math.round(revenuePyg / paidOrderCount) : null,
    byProduct: [...byProduct.values()].sort((a, b) => b.revenuePyg - a.revenuePyg),
    byZone,
    byMethod,
    customers: {
      new: newPhones.size,
      returning: returningPhones.size,
      newRevenuePyg,
      returningRevenuePyg,
    },
    series: dateKeysInclusive(fromKey, toKey).map((date) => ({
      date,
      revenuePyg: seriesMap.get(date)?.revenuePyg ?? 0,
      payments: seriesMap.get(date)?.payments ?? 0,
    })),
  };
}
