import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lineTotals } from './journal.js';
import {
  linesCogs,
  linesCustomerPayment,
  linesExpense,
  linesIvaRetention,
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
    const lines = linesSaleRecognition({
      lines: [{ grossPyg: 110_000, ivaTreatment: 'IVA_10' }],
      settlement: 'CONTADO',
      prepaid: 110_000,
      memo: 'cierre',
    });
    assert.equal(lineTotals(lines).debit, 110_000);
    assert.ok(lines.some((l) => l.role === 'VENTAS' && l.credit === 100_000));
    assert.ok(lines.some((l) => l.role === 'IVA_DEBITO' && l.credit === 10_000));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.debit === 110_000));
  });

  it('cierre a crédito deja cuenta por cobrar', () => {
    const lines = linesSaleRecognition({
      lines: [{ grossPyg: 110_000, ivaTreatment: 'IVA_10' }],
      settlement: 'CREDITO',
      prepaid: 0,
      memo: 'cierre',
    });
    assert.ok(lines.some((l) => l.role === 'CXC' && l.debit === 110_000));
  });

  it('crédito con anticipo reclasifica el cobro a CxC', () => {
    const lines = linesSaleRecognition({
      lines: [{ grossPyg: 110_000, ivaTreatment: 'IVA_10' }],
      settlement: 'CREDITO',
      prepaid: 50_000,
      memo: 'cierre',
    });
    assert.equal(lineTotals(lines).debit, lineTotals(lines).credit);
    assert.ok(lines.some((l) => l.role === 'CXC' && l.debit === 110_000));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.debit === 50_000));
    assert.ok(lines.some((l) => l.role === 'CXC' && l.credit === 50_000));
  });

  it('pedido con líneas mixtas: solo las líneas 10%/5% aportan IVA_DEBITO', () => {
    const lines = linesSaleRecognition({
      lines: [
        { grossPyg: 110_000, ivaTreatment: 'IVA_10' }, // net 100.000 + iva 10.000
        { grossPyg: 105_000, ivaTreatment: 'IVA_5' }, // net 100.000 + iva 5.000
        { grossPyg: 50_000, ivaTreatment: 'EXENTA' }, // net 50.000 + iva 0
      ],
      settlement: 'CONTADO',
      prepaid: 0,
      memo: 'cierre mixto',
    });
    assert.equal(lineTotals(lines).debit, lineTotals(lines).credit);
    assert.ok(lines.some((l) => l.role === 'VENTAS' && l.credit === 250_000));
    assert.ok(lines.some((l) => l.role === 'IVA_DEBITO' && l.credit === 15_000));
    assert.ok(lines.some((l) => l.role === 'CXC' && l.debit === 265_000));
  });

  it('pedido 100% EXENTA no postea ninguna línea de IVA_DEBITO', () => {
    const lines = linesSaleRecognition({
      lines: [{ grossPyg: 640_000, ivaTreatment: 'EXENTA' }],
      settlement: 'CONTADO',
      prepaid: 0,
      memo: 'venta talonario prestado',
    });
    assert.ok(lines.some((l) => l.role === 'VENTAS' && l.credit === 640_000));
    assert.ok(!lines.some((l) => l.role === 'IVA_DEBITO'));
    assert.equal(lineTotals(lines).debit, lineTotals(lines).credit);
  });

  it('retención de IVA va a crédito fiscal y cierra el anticipo', () => {
    const lines = linesIvaRetention(162_909, 'retención');
    assert.equal(lineTotals(lines).debit, 162_909);
    assert.ok(lines.some((l) => l.role === 'IVA_CREDITO' && l.debit === 162_909));
    assert.ok(lines.some((l) => l.role === 'ANTICIPO_CLIENTES' && l.credit === 162_909));
  });

  it('CMV contra inventario', () => {
    const lines = linesCogs(40_000, 'cogs');
    assert.ok(lines.some((l) => l.role === 'CMV' && l.debit === 40_000));
    assert.ok(lines.some((l) => l.role === 'INVENTARIO' && l.credit === 40_000));
  });

  it('flete de venta contra caja, con IVA (default IVA_10)', () => {
    const lines = linesShippingPaid(11_000, 'flete');
    assert.ok(lines.some((l) => l.role === 'CAJA' && l.credit === 11_000));
    assert.ok(lines.some((l) => l.role === 'FLETE_VENTAS' && l.debit === 10_000));
    assert.ok(lines.some((l) => l.role === 'IVA_CREDITO' && l.debit === 1_000));
  });

  it('flete EXENTA (transportadora sin RUC propio de Kampro) no toma IVA_CREDITO', () => {
    const lines = linesShippingPaid(31_600, 'flete talonario prestado', 'EXENTA');
    assert.ok(lines.some((l) => l.role === 'CAJA' && l.credit === 31_600));
    assert.ok(lines.some((l) => l.role === 'FLETE_VENTAS' && l.debit === 31_600));
    assert.ok(!lines.some((l) => l.role === 'IVA_CREDITO'));
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
      ivaTreatment: 'EXENTA',
      expenseRole: 'SUELDOS',
      treasury: 'BANCO',
      memo: 'sueldo',
    });
    assert.ok(lines.some((l) => l.role === 'SUELDOS' && l.debit === 3_000_000));
    assert.ok(!lines.some((l) => l.role === 'IVA_CREDITO' && l.debit > 0));
  });

  it('gasto con IVA 10% aparta crédito fiscal ÷11', () => {
    const lines = linesExpense({
      gross: 110_000,
      ivaTreatment: 'IVA_10',
      expenseRole: 'GASTOS_GENERALES',
      treasury: 'BANCO',
      memo: 'gasto 10',
    });
    assert.ok(lines.some((l) => l.role === 'GASTOS_GENERALES' && l.debit === 100_000));
    assert.ok(lines.some((l) => l.role === 'IVA_CREDITO' && l.debit === 10_000));
    assert.ok(lines.some((l) => l.role === 'BANCO' && l.credit === 110_000));
  });

  it('gasto con IVA 5% aparta crédito fiscal ÷21', () => {
    const lines = linesExpense({
      gross: 105_000,
      ivaTreatment: 'IVA_5',
      expenseRole: 'GASTOS_GENERALES',
      treasury: 'CAJA',
      memo: 'gasto 5',
    });
    assert.ok(lines.some((l) => l.role === 'GASTOS_GENERALES' && l.debit === 100_000));
    assert.ok(lines.some((l) => l.role === 'IVA_CREDITO' && l.debit === 5_000));
    assert.ok(lines.some((l) => l.role === 'CAJA' && l.credit === 105_000));
  });
});
