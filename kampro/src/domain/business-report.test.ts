import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePeriod,
  classifyPhone,
  deltaPct,
  goalProgress,
  importSpendInRange,
  periodRange,
  previousPeriodRange,
  targetForPeriod,
  unpaidBalance,
} from './business-report.js';

describe('períodos America/Asuncion', () => {
  it('el día usa la fecha de Asunción, no UTC', () => {
    const stillThursdayInAsuncion = new Date('2026-08-28T02:00:00.000Z');
    assert.deepEqual(periodRange('day', stillThursdayInAsuncion), { fromKey: '2026-08-27', toKey: '2026-08-27' });
  });

  it('la semana es lunes a domingo', () => {
    const friday = new Date('2026-08-28T15:00:00.000Z');
    assert.deepEqual(periodRange('week', friday), { fromKey: '2026-08-24', toKey: '2026-08-30' });
  });

  it('el mes y el año son calendario', () => {
    const now = new Date('2026-08-28T15:00:00.000Z');
    assert.deepEqual(periodRange('month', now), { fromKey: '2026-08-01', toKey: '2026-08-31' });
    assert.deepEqual(periodRange('year', now), { fromKey: '2026-01-01', toKey: '2026-12-31' });
  });

  it('el período anterior es el calendario previo, no la misma cantidad de días del mes', () => {
    const month = periodRange('month', new Date('2026-08-28T15:00:00.000Z'));
    assert.deepEqual(previousPeriodRange('month', month), { fromKey: '2026-07-01', toKey: '2026-07-31' });
  });
});

describe('metas e ingresos', () => {
  it('sin meta cargada no inventa porcentaje', () => {
    assert.deepEqual(goalProgress(100, null), { pct: null, remaining: null });
    assert.deepEqual(goalProgress(100, 0), { pct: null, remaining: null });
  });

  it('la meta del período toma el campo correspondiente', () => {
    const targets = { dayPyg: 1, weekPyg: 2, monthPyg: 3, yearPyg: 4 };
    assert.equal(targetForPeriod('month', targets), 3);
  });

  it('delta vs período anterior queda vacío si no hay base', () => {
    assert.equal(deltaPct(100, 0), null);
    assert.equal(deltaPct(0, 0), 0);
    assert.equal(deltaPct(150, 100), 50);
  });

  it('ingresos del período son pagos confirmados; unidades se cuentan una vez por pedido', () => {
    const lines = [{ sku: 'J50', name: 'Jeringa 50', quantity: 2, lineTotal: 170000 }];
    const out = aggregatePeriod(
      [
        {
          paidAt: new Date('2026-08-10T15:00:00.000Z'),
          amount: 100000,
          method: 'TRANSFERENCIA',
          phone: '595981111',
          zone: 'INTERIOR',
          orderId: 'o1',
          lines,
        },
        {
          paidAt: new Date('2026-08-12T15:00:00.000Z'),
          amount: 70000,
          method: 'TRANSFERENCIA',
          phone: '595981111',
          zone: 'INTERIOR',
          orderId: 'o1',
          lines,
        },
      ],
      { '595981111': '2026-08-10' },
      '2026-08-01',
      '2026-08-31',
    );
    assert.equal(out.revenuePyg, 170000);
    assert.equal(out.paidOrderCount, 1);
    assert.equal(out.unitsSold, 2);
    assert.equal(out.customers.new, 1);
    assert.equal(out.customers.returning, 0);
  });

  it('cliente con primer pago anterior es recurrente', () => {
    const out = aggregatePeriod(
      [
        {
          paidAt: new Date('2026-08-10T15:00:00.000Z'),
          amount: 80000,
          method: 'EFECTIVO',
          phone: '595982222',
          zone: 'ASUNCION',
          orderId: 'o2',
          lines: [{ sku: 'J2', name: '2 ml', quantity: 1, lineTotal: 80000 }],
        },
      ],
      { '595982222': '2026-01-15' },
      '2026-08-01',
      '2026-08-31',
    );
    assert.equal(out.customers.new, 0);
    assert.equal(out.customers.returning, 1);
    assert.equal(classifyPhone('2026-01-15', '2026-08-01', '2026-08-31'), 'returning');
  });

  it('saldo por cobrar no baja de cero', () => {
    assert.equal(unpaidBalance(100, 40), 60);
    assert.equal(unpaidBalance(100, 150), 0);
  });

  it('importación cancelada o borrador no cuenta; sin FX no inventa Gs de China', () => {
    const base = {
      confirmedAt: new Date('2026-08-10T12:00:00.000Z'),
      closedAt: null as Date | null,
      quantity: 10,
      unitPrice: '2.5',
      freight: '40',
      otherCharges: '5',
      customsCost: '100',
      dispatchCost: '20',
      fxRateToPyg: '1000' as string | null,
    };
    assert.equal(importSpendInRange({ ...base, status: 'CANCELADA' }, '2026-08-01', '2026-08-31').pyg, 0);
    assert.equal(importSpendInRange({ ...base, status: 'BORRADOR' }, '2026-08-01', '2026-08-31').pyg, 0);
    assert.equal(importSpendInRange({ ...base, status: 'CONFIRMADA' }, '2026-08-01', '2026-08-31').pyg, 70000);
    assert.deepEqual(
      importSpendInRange({ ...base, status: 'CONFIRMADA', fxRateToPyg: null }, '2026-08-01', '2026-08-31'),
      { pyg: 0, missingFx: true },
    );
  });
});
