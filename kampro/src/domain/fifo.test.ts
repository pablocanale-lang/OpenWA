import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTakesToLots, consumeFifo } from './fifo.js';

const lots = [
  { id: 'a', receivedAt: new Date('2026-01-01'), qtyRemaining: 2, unitCostPyg: 1000 },
  { id: 'b', receivedAt: new Date('2026-03-01'), qtyRemaining: 5, unitCostPyg: 1500 },
];

describe('PEPS', () => {
  it('sale primero el lote más viejo', () => {
    const { takes, totalCostPyg } = consumeFifo(lots, 3);
    assert.deepEqual(
      takes.map((row) => ({ lotId: row.lotId, quantity: row.quantity, costPyg: row.costPyg })),
      [
        { lotId: 'a', quantity: 2, costPyg: 2000 },
        { lotId: 'b', quantity: 1, costPyg: 1500 },
      ],
    );
    assert.equal(totalCostPyg, 3500);
  });

  it('falla si no alcanza', () => {
    assert.throws(() => consumeFifo(lots, 10), /faltan 3/);
  });

  it('actualiza cantidades restantes', () => {
    const { takes } = consumeFifo(lots, 3);
    const next = applyTakesToLots(lots, takes);
    assert.equal(next.find((l) => l.id === 'a')?.qtyRemaining, 0);
    assert.equal(next.find((l) => l.id === 'b')?.qtyRemaining, 4);
  });
});
