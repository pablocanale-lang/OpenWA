import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocateCosts, totalsByCurrency } from './landed-cost.js';

describe('allocateCosts', () => {
  const purchases = [
    {
      id: 'p1',
      productId: 'prod1',
      sku: 'JER-50ML',
      quantity: 100,
      unitPrice: '2.5',
      total: '250',
      currency: 'USD',
      fxRateToPyg: '7500',
      purchasedAt: new Date('2026-01-01'),
      supplierName: 'Alibaba Co',
      shipmentReference: 'FWD-1',
    },
    {
      id: 'p2',
      productId: 'prod2',
      sku: 'JER-2ML',
      quantity: 100,
      unitPrice: '1',
      total: '100',
      currency: 'USD',
      fxRateToPyg: '7500',
      purchasedAt: new Date('2026-01-01'),
      supplierName: 'Alibaba Co',
      shipmentReference: 'FWD-1',
    },
  ];

  it('prorratea costos de envío por cantidad y suma costos directos', () => {
    const rows = allocateCosts(purchases, [
      {
        id: 'c-ship',
        purchaseId: null,
        type: 'LOGISTICA',
        description: 'forwarder',
        amount: '80',
        currency: 'USD',
        fxRateToPyg: '7500',
      },
      {
        id: 'c-direct',
        purchaseId: 'p1',
        type: 'ADUANA',
        description: 'solo 50ml',
        amount: '20',
        currency: 'USD',
        fxRateToPyg: '7500',
      },
    ]);

    const p1 = rows.find((r) => r.purchase.id === 'p1')!;
    const p2 = rows.find((r) => r.purchase.id === 'p2')!;
    assert.equal(p1.importAllocated.find((c) => c.shared)?.allocatedAmount, '40');
    assert.equal(p2.importAllocated.find((c) => c.shared)?.allocatedAmount, '40');
    assert.equal(p1.importAllocated.find((c) => !c.shared)?.allocatedAmount, '20');
    assert.equal(p1.importPyg, 40 * 7500 + 20 * 7500);
    assert.equal(p1.landedPyg, 250 * 7500 + 60 * 7500);
    assert.equal(p2.landedPyg, 100 * 7500 + 40 * 7500);
  });

  it('no inventa PYG si falta tipo de cambio', () => {
    const rows = allocateCosts(
      [{ ...purchases[0]!, fxRateToPyg: null }],
      [
        {
          id: 'c1',
          purchaseId: null,
          type: 'LOGISTICA',
          description: null,
          amount: '10',
          currency: 'USD',
          fxRateToPyg: null,
        },
      ],
    );
    assert.equal(rows[0]?.purchasePyg, null);
    assert.equal(rows[0]?.landedPyg, null);
  });

  it('agrupa totales por moneda', () => {
    const rows = allocateCosts(purchases, [
      {
        id: 'c-pyg',
        purchaseId: null,
        type: 'IMPUESTO',
        description: 'IVA local',
        amount: '500000',
        currency: 'PYG',
        fxRateToPyg: null,
      },
    ]);
    const totals = totalsByCurrency(rows);
    assert.equal(totals.USD?.purchase, 350);
    assert.equal(totals.PYG?.import, 500000);
  });
});
