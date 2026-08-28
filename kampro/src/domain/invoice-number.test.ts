import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatInvoiceNumber } from './invoice-number.js';

describe('formatInvoiceNumber', () => {
  it('emite 001-001-0000014 como primera factura', () => {
    assert.equal(formatInvoiceNumber(14), '001-001-0000014');
  });

  it('rellena a 7 dígitos', () => {
    assert.equal(formatInvoiceNumber(1), '001-001-0000001');
  });
});
