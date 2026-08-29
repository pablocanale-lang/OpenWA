import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePygInput } from './pyg-input.js';

describe('parsePygInput', () => {
  it('keeps a plain integer', () => {
    assert.equal(parsePygInput(222000), 222000);
    assert.equal(parsePygInput('222000'), 222000);
  });

  it('reads Paraguayan thousand dots as part of the amount', () => {
    assert.equal(parsePygInput('222.000'), 222000);
    assert.equal(parsePygInput('1.250.000'), 1250000);
  });

  it('reads a comma as decimals and still returns guaraníes', () => {
    assert.equal(parsePygInput('222.000,40'), 222000);
  });
});
