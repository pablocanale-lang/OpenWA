import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lineTotals } from './journal.js';
import {
  linesCogs,
  linesCustomerPayment,
  linesExpense,
  linesPoPayment,
  linesPoReceive,
  linesSaleRecognition,
  linesShippingPaid,
} from './accounting-posting.js';

describe('armado de asientos', () => {
  it('cobro adelantado va a anticipo, no a venta', () => {
    const lines = linesCustomerPayment(110_000, 'BANCO', 'cobro');
    assert.equal(lineTotals(lines).debit, 110_000);
    assert.ok(lines.some((l) => l.role === 'BANCO' && l.debit === 110_000));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.credit === 110_000));
  });

  it('cierre al contado con cobro previo desafecta anticipo y reconoce venta neta + IVA', () => {
    const lines = linesSaleRecognition({ gross: 110_000, settlement: 'CONTADO', prepaid: 110_000, memo: 'cierre' });
    assert.equal(lineTotals(lines).debit, 110_000);
    assert.ok(lines.some((l) => l.role === 'VENTAS' && l.credit === 100_000));
    assert.ok(lines.some((l) => l.role === 'IVA_DEBITO' && l.credit === 10_000));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.debit === 110_000));
  });

  it('cierre a crédito deja cuenta por cobrar', () => {
    const lines = linesSaleRecognition({ gross: 110_000, settlement: 'CREDITO', prepaid: 0, memo: 'cierre' });
    assert.ok(lines.some((l) => l.role === 'CXC' && l.debit === 110_000));
  });

  it('crédito con anticipo reclasifica el cobro a CxC', () => {
    const lines = linesSaleRecognition({ gross: 110_000, settlement: 'CREDITO', prepaid: 50_000, memo: 'cierre' });
    assert.equal(lineTotals(lines).debit, lineTotals(lines).credit);
    assert.ok(lines.some((l) => l.role === 'CXC' && l.debit === 110_000));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.debit === 50_000));
    assert.ok(lines.some((l) => l.role === 'CXC' && l.credit === 50_000));
  });

  it('CMV contra inventario', () => {
    const lines = linesCogs(40_000, 'cogs');
    assert.ok(lines.some((l) => l.role === 'CMV' && l.debit === 40_000));
    assert.ok(lines.some((l) => l.role === 'INVENTARIO' && l.credit === 40_000));
  });

  it('flete de venta contra caja, con IVA', () => {
    const lines = linesShippingPaid(11_000, 'flete');
    assert.ok(lines.some((l) => l.role === 'CAJA' && l.credit === 11_000));
    assert.ok(lines.some((l) => l.role === 'FLETE_VENTAS' && l.debit === 10_000));
  });

  it('pago de OC pone mercadería en tránsito', () => {
    const lines = linesPoPayment(2_000_000, 'BANCO', 'pago');
    assert.ok(lines.some((l) => l.role === 'TRANSITO' && l.debit === 2_000_000));
    assert.ok(lines.some((l) => l.role === 'BANCO' && l.credit === 2_000_000));
  });

  it('recepción capitaliza tránsito + neto local y aparta IVA', () => {
    const lines = linesPoReceive({ chinaPyg: 2_000_000, localGross: 1_100_000, treasury: 'BANCO', memo: 'cierre' });
    assert.equal(lineTotals(lines).debit, lineTotals(lines).credit);
    assert.ok(lines.some((l) => l.role === 'INVENTARIO' && l.debit === 3_000_000));
    assert.ok(lines.some((l) => l.role === 'IVA_CREDITO' && l.debit === 100_000));
  });

  it('sueldo sin IVA va entero al gasto', () => {
    const lines = linesExpense({
      gross: 3_000_000,
      ivaIncluded: false,
      expenseRole: 'SUELDOS',
      treasury: 'BANCO',
      memo: 'sueldo',
    });
    assert.ok(lines.some((l) => l.role === 'SUELDOS' && l.debit === 3_000_000));
    assert.ok(!lines.some((l) => l.role === 'IVA_CREDITO' && l.debit > 0));
  });
});
