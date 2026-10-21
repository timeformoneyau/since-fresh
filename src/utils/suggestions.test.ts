/**
 * Tests for the common-things table: suggestions while typing, and the
 * starters on an empty list, from one source.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getSuggestion, STARTERS } from './suggestions.ts';
import { DEFAULT_CATEGORIES } from '../types/index.ts';

describe('starters', () => {
  test('each one, typed as a name, suggests its own gap', () => {
    for (const s of STARTERS) {
      assert.deepEqual(getSuggestion(s.name), { repeatValue: s.repeatValue, repeatUnit: s.repeatUnit }, s.name);
    }
  });

  test('a short list of everyday household things, in known categories', () => {
    assert.ok(STARTERS.length >= 6 && STARTERS.length <= 8);
    assert.equal(new Set(STARTERS.map((s) => s.name)).size, STARTERS.length);
    for (const s of STARTERS) assert.ok((DEFAULT_CATEGORIES as readonly string[]).includes(s.category), s.category);
  });
});

describe('suggestions while typing', () => {
  test('existing ones are unchanged', () => {
    assert.deepEqual(getSuggestion('Rotate tyres'), { repeatValue: 6, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('Dishwasher filter'), { repeatValue: 3, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('HVAC air filter'), { repeatValue: 6, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('Clean fridge coils'), { repeatValue: 6, repeatUnit: 'months' });
    assert.equal(getSuggestion('ab'), null);
    assert.equal(getSuggestion('Haircut'), null);
  });

  test('new Australian ones', () => {
    assert.deepEqual(getSuggestion('Aircon filter'), { repeatValue: 3, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('Ute rego'), { repeatValue: 12, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('Termite inspection'), { repeatValue: 12, repeatUnit: 'months' });
    assert.deepEqual(getSuggestion('Clean gutters'), { repeatValue: 12, repeatUnit: 'months' });
  });
});
