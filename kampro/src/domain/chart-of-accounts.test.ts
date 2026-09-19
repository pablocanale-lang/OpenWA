import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUenoPygName,
  isUenoUsdName,
  nextChildCode,
  SYSTEM_ACCOUNTS,
} from './chart-of-accounts.js';

describe('plan de cuentas', () => {
  it('cada rol de tesorería e inventario existe una sola vez', () => {
    const roles = SYSTEM_ACCOUNTS.map((a) => a.role).filter(Boolean);
    assert.equal(new Set(roles).size, roles.length);
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'CAJA' && a.postable));
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'BANCO' && a.postable));
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'INVENTARIO' && a.postable));
  });

  it('Banco es padre no imputable y el rol BANCO vive en ueno PYG', () => {
    const banco = SYSTEM_ACCOUNTS.find((a) => a.code === '1.1.02');
    const pyg = SYSTEM_ACCOUNTS.find((a) => a.code === '1.1.02.01');
    const usd = SYSTEM_ACCOUNTS.find((a) => a.code === '1.1.02.02');
    assert.equal(banco?.postable, false);
    assert.equal(banco?.role, undefined);
    assert.equal(pyg?.parentCode, '1.1.02');
    assert.equal(pyg?.role, 'BANCO');
    assert.equal(pyg?.postable, true);
    assert.equal(usd?.parentCode, '1.1.02');
    assert.equal(usd?.postable, true);
    assert.equal(usd?.role, undefined);
  });

  it('reconoce las cajas de ahorro ueno por el nombre', () => {
    assert.equal(isUenoPygName('Caja Ahorro ueno Bank, PYG'), true);
    assert.equal(isUenoPygName('UENO BANK - cta. ahorro 6193146823 - PYG'), true);
    assert.equal(isUenoUsdName('UENO BANK - cta. ahorro 6113146824 - USD'), true);
    assert.equal(isUenoPygName('UENO BANK - cta. ahorro 6113146824 - USD'), false);
    assert.equal(isUenoUsdName('UENO BANK - cta. ahorro 6193146823 - PYG'), false);
    assert.equal(isUenoPygName('Caja de ahorro ueno Bank'), true);
    assert.equal(isUenoPygName('Caja de ahorro ueno Bank PYG'), true);
    assert.equal(isUenoUsdName('Caja Ahorro ueno Bank, USD'), true);
    assert.equal(isUenoUsdName('Caja de ahorro ueno Bank dólares'), true);
    assert.equal(isUenoPygName('Caja Ahorro ueno Bank, USD'), false);
    assert.equal(isUenoUsdName('Caja Ahorro ueno Bank, PYG'), false);
    assert.equal(isUenoPygName('Banco'), false);
  });

  it('agrega 6.1.10 bajo gastos si ya están impuestos y comerciales', () => {
    assert.equal(
      nextChildCode(
        '6',
        SYSTEM_ACCOUNTS.filter((a) => a.parentCode === '6').map((a) => a.code),
      ),
      '6.1.10',
    );
  });

  it('numera hijas de Banco como 1.1.02.01', () => {
    assert.equal(nextChildCode('1.1.02', []), '1.1.02.01');
    assert.equal(nextChildCode('1.1.02', ['1.1.02.01']), '1.1.02.02');
  });
});
