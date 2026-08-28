import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { netByProduct, qtyNeededBySku, saleDelta } from './stock.js';

describe('stock math', () => {
  it('agrupa cantidades por SKU', () => {
    const qty = qtyNeededBySku([
      { sku: 'JER-50ML', quantity: 2 },
      { sku: 'JER-2ML', quantity: 1 },
      { sku: 'JER-50ML', quantity: 1 },
    ]);
    assert.equal(qty.get('JER-50ML'), 3);
    assert.equal(qty.get('JER-2ML'), 1);
  });

  it('al crear un pedido de 2, el delta es -2', () => {
    assert.equal(saleDelta(0, 2), -2);
  });

  it('si baja de 2 a 1 unidad, el delta devuelve 1 al stock', () => {
    assert.equal(saleDelta(-2, 1), 1);
  });

  it('si sube de 1 a 3, el delta saca 2 más', () => {
    assert.equal(saleDelta(-1, 3), -2);
  });

  it('cancelar deja el neto en 0', () => {
    const net = netByProduct([
      { productId: 'p1', quantity: -2 },
      { productId: 'p1', quantity: 2 },
    ]);
    assert.equal(net.get('p1'), 0);
  });
});
