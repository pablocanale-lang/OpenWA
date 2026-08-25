import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discountPercentForQty, quoteTotalPyg } from './order-pricing.js';

describe('discountPercentForQty', () => {
  it('aplica 15% solo a 2 unidades', () => {
    assert.equal(discountPercentForQty(1), 0);
    assert.equal(discountPercentForQty(2), 15);
    assert.equal(discountPercentForQty(3), 0);
    assert.equal(discountPercentForQty(8), 0);
  });

  it('no inventa descuento mayorista', () => {
    assert.equal(discountPercentForQty(9), 0);
  });
});

describe('quoteTotalPyg', () => {
  it('calcula precio × cantidad con descuento', () => {
    assert.equal(quoteTotalPyg(100_000, 1, 0), 100_000);
    assert.equal(quoteTotalPyg(100_000, 2, 15), 170_000);
  });

  it('acepta descuento manual distinto del automático', () => {
    assert.equal(quoteTotalPyg(100_000, 3, 0), 300_000);
    assert.equal(quoteTotalPyg(100_000, 2, 0), 200_000);
  });
});
