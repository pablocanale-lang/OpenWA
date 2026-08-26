import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSalesNotifyMessage } from './sales-notify.js';

describe('formatSalesNotifyMessage', () => {
  it('incluye productos, RUC y datos de Asunción', () => {
    const text = formatSalesNotifyMessage({
      id: 'ord-1',
      recipientName: 'Ana',
      invoiceName: 'Ana SA',
      customerPhone: '595981111111',
      ruc: '80012345-1',
      zone: 'ASUNCION',
      totalAmount: 170000,
      items: [{ sku: 'JER-50ML', productName: 'Jeringa 50 ml', quantity: 2, lineTotal: 170000 }],
      locationText: 'Villa Morra',
      preferredTime: '2026-08-26T18:00:00.000Z',
      paymentMethodPreferred: 'EFECTIVO',
    });
    assert.match(text, /Pedido nuevo/);
    assert.match(text, /JER-50ML/);
    assert.match(text, /80012345-1/);
    assert.match(text, /Ana/);
    assert.match(text, /Villa Morra/);
    assert.match(text, /Asunción/);
  });

  it('incluye ciudad y transportadora en Interior', () => {
    const text = formatSalesNotifyMessage({
      id: 'ord-2',
      recipientName: 'Luis',
      invoiceName: 'Luis',
      customerPhone: '595982222222',
      ruc: '1234567-8',
      zone: 'INTERIOR',
      totalAmount: 80000,
      items: [{ sku: 'JER-2ML', productName: 'Jeringa 2 ml', quantity: 1, lineTotal: 80000 }],
      city: 'Encarnación',
      carrier: 'NCC',
      event: 'paid',
      payments: [{ amount: 80000, method: 'TRANSFERENCIA', reference: 'TRX-1' }],
    });
    assert.match(text, /Encarnación/);
    assert.match(text, /NCC/);
    assert.match(text, /Pago confirmado/);
  });
});
