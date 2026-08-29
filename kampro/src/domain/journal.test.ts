import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBalanced, compactDraftLines, formatJournalNumber, reverseLines } from './journal.js';

describe('asiento', () => {
  it('numera A-000014', () => {
    assert.equal(formatJournalNumber(14), 'A-000014');
  });

  it('exige balance', () => {
    assert.throws(() => assertBalanced([{ debit: 100, credit: 0 }]), /desbalanceado/);
    assert.doesNotThrow(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]));
  });

  it('revierte débito y crédito', () => {
    assert.deepEqual(reverseLines([{ debit: 10, credit: 0, memo: 'x' }]), [{ debit: 0, credit: 10, memo: 'x' }]);
  });

  it('omite ceros', () => {
    assert.equal(compactDraftLines([{ debit: 0, credit: 0 }, { debit: 1, credit: 0 }]).length, 1);
  });
});
