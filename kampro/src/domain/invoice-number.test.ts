import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInvoiceNumber,
  normalizeInvoiceNumber,
  parseInvoiceNumber,
  sequenceAfterAssign,
} from './invoice-number.js';

describe('formatInvoiceNumber', () => {
  it('emite 001-001-0000014 como primera factura', () => {
    assert.equal(formatInvoiceNumber(14), '001-001-0000014');
  });

  it('rellena a 7 dígitos', () => {
    assert.equal(formatInvoiceNumber(1), '001-001-0000001');
  });
});

describe('parseInvoiceNumber', () => {
  it('acepta el formato timbrado completo', () => {
    assert.deepEqual(parseInvoiceNumber('001-001-0000016'), {
      establishment: '001',
      point: '001',
      sequence: 16,
    });
  });

  it('acepta solo el consecutivo', () => {
    assert.deepEqual(parseInvoiceNumber('18'), {
      establishment: '001',
      point: '001',
      sequence: 18,
    });
  });

  it('acepta el timbrado con el consecutivo corto', () => {
    assert.equal(normalizeInvoiceNumber('001-001-18'), '001-001-0000018');
  });

  it('rechaza vacío', () => {
    assert.throws(() => parseInvoiceNumber('  '), /obligatorio/);
  });

  it('rechaza texto libre', () => {
    assert.throws(() => parseInvoiceNumber('FC-16'), /001-001/);
  });
});

describe('sequenceAfterAssign', () => {
  it('avanza la secuencia si se salta un número anulado', () => {
    assert.equal(sequenceAfterAssign(16, 18), 19);
  });

  it('no retrocede si se usa un número anterior libre', () => {
    assert.equal(sequenceAfterAssign(16, 14), 16);
  });

  it('avanza uno si se usa exactamente el próximo', () => {
    assert.equal(sequenceAfterAssign(16, 16), 17);
  });
});
