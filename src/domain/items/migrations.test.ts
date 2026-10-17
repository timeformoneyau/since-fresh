/**
 * Tests for local storage migration.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndMigrate, STORAGE_VERSION } from './migrations.ts';

const base = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('parseAndMigrate', () => {
  test('an old food item becomes tracked-only and keeps its name and category', () => {
    const raw = JSON.stringify({
      version: 2,
      items: [
        {
          ...base,
          id: 'milk',
          name: 'Milk',
          category: 'Food',
          lastDoneDate: '2026-03-01',
          history: [],
          repeatValue: 7,
          repeatUnit: 'days',
          expiryDate: '2026-03-08',
          source: 'photo',
        },
      ],
    });

    const [item] = parseAndMigrate(raw);

    assert.equal(item.name, 'Milk');
    assert.equal(item.category, 'Food');
    assert.equal(item.repeatValue, null);
    assert.equal(item.repeatUnit, null);
    assert.deepEqual(item.history, [{ id: 'milk_seed', date: '2026-03-01' }]);
    assert.ok(!('expiryDate' in item));
    assert.ok(!('source' in item));
  });

  test('a normal repeat item passes through unchanged apart from the stripped fields', () => {
    const stored = {
      ...base,
      id: 'filter',
      name: 'Change water filter',
      category: 'Household',
      lastDoneDate: '2026-02-10',
      history: [
        { id: 'e2', date: '2026-02-10' },
        { id: 'e1', date: '2025-11-10' },
      ],
      repeatValue: 3,
      repeatUnit: 'months',
    };
    const raw = JSON.stringify({
      version: 2,
      items: [{ ...stored, expiryDate: null, source: 'manual' }],
    });

    assert.deepEqual(parseAndMigrate(raw), [stored]);
  });

  test('a legacy bare-array payload still loads', () => {
    const raw = JSON.stringify([
      {
        ...base,
        id: 'dentist',
        name: 'Dentist',
        category: 'Health',
        lastDoneDate: '2025-12-01',
        repeatValue: 6,
        repeatUnit: 'months',
      },
    ]);

    const items = parseAndMigrate(raw);

    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'Dentist');
    assert.deepEqual(items[0].history, [{ id: 'dentist_seed', date: '2025-12-01' }]);
    assert.ok(!('expiryDate' in items[0]));
  });

  test('storage version is 3', () => {
    assert.equal(STORAGE_VERSION, 3);
  });
});
