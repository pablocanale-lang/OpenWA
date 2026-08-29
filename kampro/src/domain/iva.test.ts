import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { netIfIncluded, splitIva11 } from './iva.js';

describe('IVA /11', () => {
  it('110.000 Gs → IVA 10.000 y neto 100.000', () => {
    assert.deepEqual(splitIva11(110_000), { gross: 110_000, iva: 10_000, net: 100_000 });
  });

  it('cero queda en cero', () => {
    assert.deepEqual(splitIva11(0), { gross: 0, iva: 0, net: 0 });
  });

  it('sueldo sin IVA no se parte', () => {
    assert.deepEqual(netIfIncluded(3_000_000, false), { gross: 3_000_000, iva: 0, net: 3_000_000 });
  });
});
