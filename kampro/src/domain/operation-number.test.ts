import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatOpNumber, operationMemo } from './operation-number.js';

describe('numeración de operaciones', () => {
  it('numera OC, PV y gasto con 6 dígitos', () => {
    assert.equal(formatOpNumber('purchase-order', 3), 'OC-000003');
    assert.equal(formatOpNumber('order', 14), 'PV-000014');
    assert.equal(formatOpNumber('expense', 1), 'G-000001');
  });

  it('arma el concepto del asiento con esa referencia', () => {
    assert.equal(operationMemo('ORDER', 'COGS', 'PV-000013'), 'CMV PV-000013');
    assert.equal(operationMemo('ORDER', 'CLOSE', 'PV-000013', '001-001-0000013'), 'Venta PV-000013 · 001-001-0000013');
    assert.equal(operationMemo('PURCHASE_ORDER', 'PAY', 'OC-000002'), 'Pago OC-000002');
    assert.equal(operationMemo('PURCHASE_ORDER', 'CLOSE', 'OC-000002'), 'Recepción OC-000002');
    assert.equal(operationMemo('PAYMENT', 'PAY', 'PV-000013'), 'Cobro PV-000013');
  });
});
