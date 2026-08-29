import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanCancel,
  assertCanClose,
  assertCanConfirm,
  assertCanEdit,
  assertCancelRefund,
  assertPurchaseLines,
  chinaCostFromMerchandise,
  completeInvoices,
  isInvoiceDraftBlank,
  landedTotal,
  needsExchangeRate,
  openTotal,
  quantityForStatus,
  resolveFxRate,
  spentForStatus,
  stockDeltasOnCancel,
  stockDeltasOnEdit,
  stockDeltasOnLinesEdit,
  summarizePurchaseOrders,
} from './purchase-orders.js';

const invoice = {
  invoiceNumber: '001-001-0000123',
  ruc: '80012345-6',
  legalName: 'Despachante SA',
  issuedAt: new Date('2026-08-01'),
  amount: '1500000',
};

describe('totales de orden de compra', () => {
  it('el total abierto suma mercadería, flete y otros cargos', () => {
    assert.equal(openTotal(10, '2.5', '40', '5'), 70);
  });

  it('al cerrar suma aduana y despacho', () => {
    assert.equal(landedTotal(10, '2.5', '40', '5', '100', '20'), 190);
  });

  it('el borrador no cuenta como gastado ni como cantidad comprada', () => {
    assert.equal(spentForStatus('BORRADOR', 10, '2.5', '40', '5', null, null, '7500'), 0);
    assert.equal(quantityForStatus('BORRADOR', 10), 0);
  });

  it('confirmada convierte la compra de China con el FX cargado; no suma aduana', () => {
    assert.equal(spentForStatus('CONFIRMADA', 10, '2.5', '40', '5', '100', '20', '1000'), 70000);
    assert.equal(quantityForStatus('CONFIRMADA', 10), 10);
  });

  it('sin tipo de cambio no inventa PYG de la compra en China', () => {
    assert.equal(spentForStatus('CONFIRMADA', 10, '2.5', '40', '5', null, null, null), 0);
  });

  it('en PYG el total ya es guaraníes y no pide tipo de cambio', () => {
    assert.equal(needsExchangeRate('PYG'), false);
    assert.equal(resolveFxRate('PYG', '7500'), null);
    assert.equal(chinaCostFromMerchandise(100000, 0, 0, null, 'PYG'), 100000);
  });

  it('USD y Yen exigen tipo de cambio', () => {
    assert.equal(needsExchangeRate('USD'), true);
    assert.equal(needsExchangeRate('YEN'), true);
    assert.throws(() => resolveFxRate('USD', ''), /tipo de cambio/);
    assert.equal(chinaCostFromMerchandise(10, 0, 0, '1000', 'JPY'), 10000);
  });
});

describe('transiciones', () => {
  it('no confirma sin comprobante de pago', () => {
    assert.throws(() => assertCanConfirm('BORRADOR', '  '), /comprobante/);
  });

  it('confirma desde borrador con comprobante', () => {
    assert.doesNotThrow(() => assertCanConfirm('BORRADOR', 'TRX-99'));
  });

  it('no cierra un borrador', () => {
    assert.throws(
      () =>
        assertCanClose('BORRADOR', {
          receivedAt: new Date(),
          customsCost: '0',
          dispatchCost: '0',
          invoices: [invoice],
        }),
      /confirmada/,
    );
  });

  it('cierra una confirmada con recepción, costos y factura', () => {
    assert.doesNotThrow(() =>
      assertCanClose('CONFIRMADA', {
        receivedAt: new Date('2026-08-12'),
        customsCost: '0',
        dispatchCost: '100',
        invoices: [invoice],
      }),
    );
  });

  it('no cierra sin factura', () => {
    assert.throws(
      () =>
        assertCanClose('CONFIRMADA', {
          receivedAt: new Date(),
          customsCost: '10',
          dispatchCost: '10',
          invoices: [],
        }),
      /factura/,
    );
  });

  it('ignora una factura extra en blanco al cerrar', () => {
    assert.doesNotThrow(() =>
      assertCanClose('CONFIRMADA', {
        receivedAt: new Date('2026-08-12'),
        customsCost: '0',
        dispatchCost: '100',
        invoices: [invoice, { invoiceNumber: '', ruc: '', legalName: '', issuedAt: new Date(), amount: '' }],
      }),
    );
    assert.equal(
      completeInvoices([invoice, { invoiceNumber: '  ', ruc: '', legalName: '', issuedAt: new Date(), amount: '' }]).length,
      1,
    );
    assert.equal(isInvoiceDraftBlank({ invoiceNumber: '', ruc: '', legalName: '', amount: '' }), true);
  });
});

describe('resumen dashboard', () => {
  it('separa borrador, abiertas y cerradas y suma compras reales', () => {
    const summary = summarizePurchaseOrders([
      {
        status: 'BORRADOR',
        quantity: 8,
        unitPrice: '10',
        freight: '0',
        otherCharges: '0',
        customsCost: null,
        dispatchCost: null,
      },
      {
        status: 'CONFIRMADA',
        quantity: 2,
        unitPrice: '10',
        freight: '5',
        otherCharges: '0',
        customsCost: null,
        dispatchCost: null,
        fxRateToPyg: '10',
      },
      {
        status: 'CERRADA',
        quantity: 4,
        unitPrice: '10',
        freight: '8',
        otherCharges: '2',
        customsCost: '20',
        dispatchCost: '10',
        fxRateToPyg: '10',
      },
    ]);
    assert.deepEqual(
      { draft: summary.draft, open: summary.open, closed: summary.closed, quantity: summary.quantity },
      { draft: 1, open: 1, closed: 1, quantity: 6 },
    );
    assert.equal(summary.spent, 250 + 530);
  });

  it('una cancelada no cuenta gastado ni unidades', () => {
    const summary = summarizePurchaseOrders([
      {
        status: 'CANCELADA',
        quantity: 20,
        unitPrice: '10',
        freight: '5',
        otherCharges: '0',
        customsCost: '100',
        dispatchCost: '20',
        fxRateToPyg: '10',
      },
    ]);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.quantity, 0);
    assert.equal(summary.spent, 0);
  });
});

describe('editar y cancelar', () => {
  it('se puede editar borrador, confirmada y cerrada', () => {
    assert.doesNotThrow(() => assertCanEdit('BORRADOR'));
    assert.doesNotThrow(() => assertCanEdit('CONFIRMADA'));
    assert.doesNotThrow(() => assertCanEdit('CERRADA'));
  });

  it('no se puede editar una cancelada', () => {
    assert.throws(() => assertCanEdit('CANCELADA'), /cancelada/);
  });

  it('se puede cancelar en cualquier estado salvo ya cancelada', () => {
    assert.doesNotThrow(() => assertCanCancel('BORRADOR'));
    assert.doesNotThrow(() => assertCanCancel('CONFIRMADA'));
    assert.doesNotThrow(() => assertCanCancel('CERRADA'));
    assert.throws(() => assertCanCancel('CANCELADA'), /ya está cancelada/);
  });

  it('una pagada o cerrada exige registrar la devolución del dinero', () => {
    assert.doesNotThrow(() => assertCancelRefund('BORRADOR', null));
    assert.throws(() => assertCancelRefund('CONFIRMADA', null), /devolución/);
    assert.doesNotThrow(() =>
      assertCancelRefund('CONFIRMADA', { amountPyg: 1000, treasury: 'BANCO', paidAt: new Date() }),
    );
  });

  it('cancelar una cerrada revierte el stock; las demás no tocan inventario', () => {
    assert.deepEqual(stockDeltasOnCancel('CERRADA', 'p1', 10), [{ productId: 'p1', quantity: -10 }]);
    assert.deepEqual(stockDeltasOnCancel('CONFIRMADA', 'p1', 10), []);
    assert.deepEqual(stockDeltasOnCancel('BORRADOR', 'p1', 10), []);
  });

  it('editar cantidad de una cerrada ajusta el delta de stock', () => {
    assert.deepEqual(stockDeltasOnEdit('CERRADA', 'p1', 10, 'p1', 12), [{ productId: 'p1', quantity: 2 }]);
    assert.deepEqual(stockDeltasOnEdit('CERRADA', 'p1', 10, 'p2', 8), [
      { productId: 'p1', quantity: -10 },
      { productId: 'p2', quantity: 8 },
    ]);
    assert.deepEqual(stockDeltasOnEdit('CONFIRMADA', 'p1', 10, 'p1', 12), []);
  });

  it('varias líneas de una cerrada ajustan stock por producto', () => {
    assert.deepEqual(
      stockDeltasOnLinesEdit(
        'CERRADA',
        [
          { productId: 'p1', quantity: 10, unitPrice: 1 },
          { productId: 'p2', quantity: 4, unitPrice: 1 },
        ],
        [
          { productId: 'p1', quantity: 10, unitPrice: 1 },
          { productId: 'p2', quantity: 6, unitPrice: 1 },
          { productId: 'p3', quantity: 2, unitPrice: 1 },
        ],
      ),
      [
        { productId: 'p2', quantity: 2 },
        { productId: 'p3', quantity: 2 },
      ],
    );
  });

  it('rechaza una orden sin productos', () => {
    assert.throws(() => assertPurchaseLines([]), /al menos un producto/);
  });
});
