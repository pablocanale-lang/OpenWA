import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discountPercentForFinalPrice, discountPercentForQty, quoteTotalPyg } from './order-pricing.js';

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

describe('discountPercentForFinalPrice', () => {
  it('redondea al entero más cercano cuando el % exacto no es entero (caso real PV-016/17/18/19)', () => {
    // 640.000 -> 600.000 necesita 6,25% exacto; no es representable (discountApplied es Int).
    assert.equal(discountPercentForFinalPrice(640_000, 1, 600_000), 6);
  });

  it('devuelve 0 si el precio final es igual o mayor al de lista', () => {
    assert.equal(discountPercentForFinalPrice(100_000, 1, 100_000), 0);
    assert.equal(discountPercentForFinalPrice(100_000, 1, 120_000), 0);
  });

  it('nunca devuelve más de 100', () => {
    assert.equal(discountPercentForFinalPrice(100_000, 1, -50_000), 100);
  });
});
