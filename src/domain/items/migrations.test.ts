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

describe('history (redesign)', () => {
  const stored = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      version: 3,
      items: [
        {
          ...base,
          id: 'hair',
          name: 'Haircut',
          category: 'Health',
          lastDoneDate: '2026-09-11',
          repeatValue: 30,
          repeatUnit: 'days',
          ...overrides,
        },
      ],
    });

  test('an item with lastDoneDate and no history gets a one-entry history; a second run changes nothing', () => {
    const once = parseAndMigrate(stored({}));
    assert.deepEqual(once[0].history, [{ id: 'hair_seed', date: '2026-09-11' }]);
    assert.equal(once[0].lastDoneDate, '2026-09-11');

    const twice = parseAndMigrate(JSON.stringify({ version: STORAGE_VERSION, items: once }));
    assert.deepEqual(twice, once);
  });

  test('entries written before the redesign (no note or createdAt) load unchanged', () => {
    const history = [
      { id: 'b', date: '2026-09-11' },
      { id: 'a', date: '2026-08-09' },
    ];
    assert.deepEqual(parseAndMigrate(stored({ history }))[0].history, history);
  });

  test('note and createdAt on entries are kept', () => {
    const history = [
      { id: 'b', date: '2026-09-11', note: 'Shorter', createdAt: '2026-09-11T08:00:00.000Z' },
      { id: 'a', date: '2026-08-09' },
    ];
    assert.deepEqual(parseAndMigrate(stored({ history }))[0].history, history);
  });

  test('a lastDoneDate moved later by the old Edit screen gets its own entry, so it never moves back', () => {
    const history = [{ id: 'a', date: '2026-08-09' }];
    const items = parseAndMigrate(stored({ lastDoneDate: '2026-09-11', history }));
    assert.equal(items[0].lastDoneDate, '2026-09-11');
    assert.deepEqual(items[0].history, [
      { id: 'hair_last_2026-09-11', date: '2026-09-11' },
      { id: 'a', date: '2026-08-09' },
    ]);
    // Idempotent
    const again = parseAndMigrate(JSON.stringify({ version: STORAGE_VERSION, items }));
    assert.deepEqual(again, items);
  });

  test('a lastDoneDate between entries is slotted into date order; nothing is removed', () => {
    const history = [
      { id: 'c', date: '2026-10-01' },
      { id: 'a', date: '2026-08-09' },
    ];
    const items = parseAndMigrate(stored({ lastDoneDate: '2026-09-11', history }));
    assert.deepEqual(items[0].history.map((e) => e.id), ['c', 'hair_last_2026-09-11', 'a']);
    assert.equal(items[0].lastDoneDate, '2026-09-11');
  });

  test('an item saved by the redesigned app still loads in the shape older builds read', () => {
    const history = [{ id: 'b', date: '2026-09-11', note: 'x', createdAt: '2026-09-11T08:00:00.000Z' }];
    const [item] = parseAndMigrate(stored({ history }));
    // Older builds read history[0] as the latest entry and need lastDoneDate
    assert.equal(item.history[0].date, item.lastDoneDate);
    assert.equal(typeof item.lastDoneDate, 'string');
  });
});
