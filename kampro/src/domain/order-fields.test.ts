import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPreferredDateTime, assertRuc, sanitizeRuc } from './order-fields.js';

describe('sanitizeRuc', () => {
  it('deja solo números y guion', () => {
    assert.equal(sanitizeRuc('800.123-45 A'), '800123-45');
  });
});

describe('assertRuc', () => {
  it('acepta dígitos con guion de dígito verificador', () => {
    assert.equal(assertRuc(' 80012345-1 '), '80012345-1');
  });

  it('acepta solo dígitos', () => {
    assert.equal(assertRuc('80012345'), '80012345');
  });

  it('rechaza letras', () => {
    assert.throws(() => assertRuc('ABC-1'), /números y un guion/);
  });

  it('rechaza vacío', () => {
    assert.throws(() => assertRuc('---'), /obligatorio/);
  });
});

describe('assertPreferredDateTime', () => {
  it('acepta datetime-local y lo pasa a ISO', () => {
    const iso = assertPreferredDateTime('2026-08-26T15:30');
    assert.equal(new Date(iso).toISOString(), iso);
    assert.equal(new Date(iso).getMinutes(), 30);
  });

  it('rechaza texto libre', () => {
    assert.throws(() => assertPreferredDateTime('después de las 3'), /fecha y hora/);
  });
});
