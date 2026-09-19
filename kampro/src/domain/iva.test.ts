import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { netIfIncluded, resolveIvaTreatment, splitByTreatment, splitIva11, splitIva21 } from './iva.js';

describe('IVA /11 y /21', () => {
  it('110.000 Gs → IVA 10.000 y neto 100.000', () => {
    assert.deepEqual(splitIva11(110_000), { gross: 110_000, iva: 10_000, net: 100_000 });
  });

  it('105.000 Gs al 5% → IVA 5.000 y neto 100.000', () => {
    assert.deepEqual(splitIva21(105_000), { gross: 105_000, iva: 5_000, net: 100_000 });
  });

  it('cero queda en cero', () => {
    assert.deepEqual(splitIva11(0), { gross: 0, iva: 0, net: 0 });
    assert.deepEqual(splitIva21(0), { gross: 0, iva: 0, net: 0 });
  });

  it('sueldo sin IVA no se parte', () => {
    assert.deepEqual(netIfIncluded(3_000_000, false), { gross: 3_000_000, iva: 0, net: 3_000_000 });
    assert.deepEqual(splitByTreatment(3_000_000, 'EXENTA'), { gross: 3_000_000, iva: 0, net: 3_000_000 });
  });

  it('tratamiento 10% usa ÷11 y 5% usa ÷21', () => {
    assert.deepEqual(splitByTreatment(110_000, 'IVA_10').iva, 10_000);
    assert.deepEqual(splitByTreatment(105_000, 'IVA_5').iva, 5_000);
  });

  it('resuelve tratamiento desde el formulario o el flag viejo', () => {
    assert.equal(resolveIvaTreatment({ ivaTreatment: 'IVA_5' }), 'IVA_5');
    assert.equal(resolveIvaTreatment({ ivaIncluded: false }), 'EXENTA');
    assert.equal(resolveIvaTreatment({ ivaIncluded: true }), 'IVA_10');
    assert.equal(resolveIvaTreatment({ kind: 'SALARIO' }), 'EXENTA');
    assert.equal(resolveIvaTreatment({ kind: 'IMPUESTO' }), 'EXENTA');
    assert.equal(resolveIvaTreatment({ kind: 'GENERAL' }), 'IVA_10');
  });
});
