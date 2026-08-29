import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOrderTransition,
  assertShippingLoadedForClose,
  canEditShippingCost,
  initialStatusForZone,
  nextStatusForAction,
  primaryActionFor,
} from './order-transitions.js';

describe('initialStatusForZone', () => {
  it('Asunción arranca en CONFIRMADO (contraentrega)', () => {
    assert.equal(initialStatusForZone('ASUNCION'), 'CONFIRMADO');
  });

  it('Interior arranca en PENDIENTE_DE_PAGO', () => {
    assert.equal(initialStatusForZone('INTERIOR'), 'PENDIENTE_DE_PAGO');
  });
});

describe('assertOrderTransition', () => {
  it('Asunción puede ir de CONFIRMADO a listo para despacho con pago pendiente', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'ASUNCION',
        status: 'CONFIRMADO',
        action: 'markReady',
        hasConfirmedPayment: false,
      }),
    );
    assert.equal(nextStatusForAction('markReady'), 'LISTO_PARA_DESPACHO');
  });

  it('Interior no puede despachar sin pago confirmado', () => {
    assert.throws(
      () =>
        assertOrderTransition({
          zone: 'INTERIOR',
          status: 'PAGO_CONFIRMADO',
          action: 'markReady',
          hasConfirmedPayment: false,
        }),
      /pago adelantado/,
    );
  });

  it('Interior confirma pago desde PENDIENTE_DE_PAGO', () => {
    assert.equal(primaryActionFor('INTERIOR', 'PENDIENTE_DE_PAGO'), 'confirmPayment');
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'INTERIOR',
        status: 'PENDIENTE_DE_PAGO',
        action: 'confirmPayment',
        hasConfirmedPayment: false,
      }),
    );
  });

  it('Asunción no usa confirmar pago adelantado', () => {
    assert.throws(
      () =>
        assertOrderTransition({
          zone: 'ASUNCION',
          status: 'CONFIRMADO',
          action: 'confirmPayment',
          hasConfirmedPayment: false,
        }),
      /inválida/,
    );
  });

  it('se puede cancelar un Interior pendiente de pago', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'INTERIOR',
        status: 'PENDIENTE_DE_PAGO',
        action: 'cancel',
        hasConfirmedPayment: false,
      }),
    );
    assert.equal(nextStatusForAction('cancel'), 'CANCELADO');
  });

  it('se puede cancelar un pedido ya pagado (reembolso + stock)', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'INTERIOR',
        status: 'PAGO_CONFIRMADO',
        action: 'cancel',
        hasConfirmedPayment: true,
      }),
    );
  });

  it('se puede cancelar un pedido ya enviado', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'ASUNCION',
        status: 'ENVIADO',
        action: 'cancel',
        hasConfirmedPayment: false,
      }),
    );
  });

  it('se puede cancelar un pedido cerrado o entregado', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'ASUNCION',
        status: 'CERRADO',
        action: 'cancel',
        hasConfirmedPayment: true,
      }),
    );
  });

  it('devolución restaura stock en pedido pagado o enviado', () => {
    assert.doesNotThrow(() =>
      assertOrderTransition({
        zone: 'INTERIOR',
        status: 'PAGO_CONFIRMADO',
        action: 'returnOrder',
        hasConfirmedPayment: true,
      }),
    );
    assert.equal(nextStatusForAction('returnOrder'), 'DEVUELTO');
  });
});

describe('assertShippingLoadedForClose', () => {
  it('exige el flete cargado para cerrar', () => {
    assert.throws(() => assertShippingLoadedForClose(null), /costo de envío/);
    assert.throws(() => assertShippingLoadedForClose(undefined), /costo de envío/);
    assert.doesNotThrow(() => assertShippingLoadedForClose(0));
    assert.doesNotThrow(() => assertShippingLoadedForClose(25000));
  });
});

describe('canEditShippingCost', () => {
  it('se puede cargar desde Enviado hasta Cerrado', () => {
    assert.equal(canEditShippingCost('ENVIADO'), true);
    assert.equal(canEditShippingCost('ENTREGADO'), true);
    assert.equal(canEditShippingCost('CERRADO'), true);
    assert.equal(canEditShippingCost('CONFIRMADO'), false);
    assert.equal(canEditShippingCost('CANCELADO'), false);
  });
});
