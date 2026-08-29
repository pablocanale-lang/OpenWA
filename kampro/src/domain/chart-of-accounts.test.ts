import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextChildCode, SYSTEM_ACCOUNTS } from './chart-of-accounts.js';

describe('plan de cuentas', () => {
  it('cada rol de tesorería e inventario existe una sola vez', () => {
    const roles = SYSTEM_ACCOUNTS.map((a) => a.role).filter(Boolean);
    assert.equal(new Set(roles).size, roles.length);
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'CAJA' && a.postable));
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'BANCO' && a.postable));
    assert.ok(SYSTEM_ACCOUNTS.some((a) => a.role === 'INVENTARIO' && a.postable));
  });

  it('agrega 6.1.08 bajo gastos si ya está 6.1.07', () => {
    assert.equal(
      nextChildCode(
        '6',
        SYSTEM_ACCOUNTS.filter((a) => a.parentCode === '6').map((a) => a.code),
      ),
      '6.1.08',
    );
  });
});
