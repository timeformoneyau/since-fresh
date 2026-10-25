/**
 * Tests for the common-things table: suggestions while typing, and the
 * starters on an empty list, from one source.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getSuggestion, STARTERS, suggestsUntil } from './suggestions.ts';
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

describe("Until it's due: names that preselect it", () => {
  test('the keywords, in any case, anywhere in the name', () => {
    for (const name of ['Car rego', 'Boat registration', 'Driver licence', 'License renewal', 'Passport', 'Netflix subscription', 'Audible trial', 'Home insurance', 'REGO']) {
      assert.equal(suggestsUntil(name), true, name);
    }
  });

  test('everything else stays on "Since I last did it"', () => {
    for (const name of ['Dentist', 'Gutters', 'Car service', 'Re', '']) assert.equal(suggestsUntil(name), false, name);
  });

  test('the car rego starter opens on "Until it\'s due", repeating; the others as before', () => {
    const rego = STARTERS.find((s) => s.name === 'Car rego')!;
    assert.deepEqual(rego.until, { repeat: true });
    assert.equal(STARTERS.filter((s) => s.until).length, 1);
  });
});
