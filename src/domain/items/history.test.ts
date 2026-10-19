/**
 * Tests for an item's history: lastDoneDate derivation, neighbour bounds,
 * "Usually", and the add / edit / delete rules.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  withHistory,
  addEntry,
  updateEntry,
  deleteEntry,
  dateBounds,
  usualIntervalDays,
  gapsNewestFirst,
  hasEntryOn,
  HistoryError,
} from './history.ts';
import type { SinceItem } from '../../types/index.ts';

const TODAY = '2026-10-19';
const NOW = '2026-10-19T09:00:00.000Z';

/** A repeating item with the given entry dates, newest first. */
function item(dates: string[], overrides: Partial<SinceItem> = {}): SinceItem {
  const history = dates.map((date, i) => ({ id: `e${i}`, date }));
  return {
    id: 'hair',
    name: 'Haircut',
    category: 'Health',
    lastDoneDate: dates[0],
    history,
    repeatValue: 30,
    repeatUnit: 'days',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

// Newest first: e0 11 Sep, e1 9 Aug, e2 8 Jul, e3 6 Jun (gaps 33, 32, 32)
const HAIRCUT = item(['2026-09-11', '2026-08-09', '2026-07-08', '2026-06-06']);

const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof HistoryError && e.code === code);

describe('lastDoneDate is derived from history', () => {
  test('withHistory sorts newest first and sets lastDoneDate', () => {
    const out = withHistory(HAIRCUT, [...HAIRCUT.history].reverse(), NOW);
    assert.deepEqual(out.history.map((e) => e.id), ['e0', 'e1', 'e2', 'e3']);
    assert.equal(out.lastDoneDate, '2026-09-11');
    assert.equal(out.updatedAt, NOW);
  });

  test('adding today moves lastDoneDate', () => {
    const out = addEntry(HAIRCUT, { id: 'new', date: TODAY }, TODAY, NOW);
    assert.equal(out.lastDoneDate, TODAY);
    assert.equal(out.history[0].id, 'new');
    assert.equal(out.history[0].createdAt, NOW);
  });

  test('adding a past entry slots it into place and leaves lastDoneDate', () => {
    const out = addEntry(HAIRCUT, { id: 'past', date: '2026-08-20', note: ' trim ' }, TODAY, NOW);
    assert.deepEqual(out.history.map((e) => e.id), ['e0', 'past', 'e1', 'e2', 'e3']);
    assert.equal(out.lastDoneDate, '2026-09-11');
    assert.equal(out.history[1].note, 'trim');
  });

  test('editing the newest entry moves lastDoneDate (and so the next due date)', () => {
    const out = updateEntry(HAIRCUT, 'e0', { date: '2026-09-20' }, TODAY, NOW);
    assert.equal(out.lastDoneDate, '2026-09-20');
  });

  test('editing an older entry leaves lastDoneDate alone', () => {
    const out = updateEntry(HAIRCUT, 'e2', { date: '2026-07-01' }, TODAY, NOW);
    assert.equal(out.lastDoneDate, '2026-09-11');
  });

  test('deleting the newest entry falls back to the one before', () => {
    const out = deleteEntry(HAIRCUT, 'e0', NOW);
    assert.equal(out.lastDoneDate, '2026-08-09');
    assert.equal(out.history.length, 3);
  });

  test('deleting an older entry leaves lastDoneDate alone', () => {
    assert.equal(deleteEntry(HAIRCUT, 'e2', NOW).lastDoneDate, '2026-09-11');
  });
});

describe('neighbour bounds', () => {
  test('a middle entry sits between the entries either side', () => {
    assert.deepEqual(dateBounds(HAIRCUT, 'e1', TODAY), { min: '2026-07-08', max: '2026-09-11' });
  });
  test('the oldest has no lower bound; the newest is bounded by today', () => {
    assert.deepEqual(dateBounds(HAIRCUT, 'e3', TODAY), { min: null, max: '2026-07-08' });
    assert.deepEqual(dateBounds(HAIRCUT, 'e0', TODAY), { min: '2026-08-09', max: TODAY });
  });
  test('the bounds are inclusive', () => {
    assert.equal(updateEntry(HAIRCUT, 'e1', { date: '2026-07-08' }, TODAY, NOW).history[2].date, '2026-07-08');
    assert.equal(updateEntry(HAIRCUT, 'e1', { date: '2026-09-11' }, TODAY, NOW).lastDoneDate, '2026-09-11');
  });
  test('out-of-range dates are rejected', () => {
    throwsCode(() => updateEntry(HAIRCUT, 'e1', { date: '2026-07-07' }, TODAY, NOW), 'out-of-range');
    throwsCode(() => updateEntry(HAIRCUT, 'e1', { date: '2026-09-12' }, TODAY, NOW), 'out-of-range');
    throwsCode(() => updateEntry(HAIRCUT, 'e3', { date: '2026-07-09' }, TODAY, NOW), 'out-of-range');
  });
  test('the oldest entry can move back as far as you like', () => {
    assert.equal(updateEntry(HAIRCUT, 'e3', { date: '2001-01-01' }, TODAY, NOW).history[3].date, '2001-01-01');
  });
  test('no future dates, when editing or adding', () => {
    throwsCode(() => updateEntry(HAIRCUT, 'e0', { date: '2026-10-20' }, TODAY, NOW), 'future');
    throwsCode(() => addEntry(HAIRCUT, { id: 'x', date: '2026-10-20' }, TODAY, NOW), 'future');
  });
  test('changing only the note never trips the date rules', () => {
    const out = updateEntry(HAIRCUT, 'e2', { note: 'Shorter this time' }, TODAY, NOW);
    assert.equal(out.history[2].note, 'Shorter this time');
    assert.equal(updateEntry(out, 'e2', { note: '  ' }, TODAY, NOW).history[2].note, undefined);
  });
});

describe('deleting', () => {
  test('the last remaining entry is kept', () => {
    throwsCode(() => deleteEntry(item(['2026-09-11']), 'e0', NOW), 'last-entry');
    throwsCode(() => deleteEntry(item(['2026-09-11'], { repeatValue: null, repeatUnit: null }), 'e0', NOW), 'last-entry');
  });
  test('an unknown entry is reported', () => {
    throwsCode(() => deleteEntry(HAIRCUT, 'nope', NOW), 'not-found');
  });
});

describe('Usually', () => {
  test('mean gap, rounded: 33, 32, 32 -> 32', () => {
    assert.deepEqual(gapsNewestFirst(HAIRCUT), [33, 32, 32]);
    assert.equal(usualIntervalDays(HAIRCUT), 32);
  });
  test('the brief\'s example: gaps 32, 32, 33 -> 32', () => {
    assert.equal(usualIntervalDays(item(['2026-09-12', '2026-08-11', '2026-07-10', '2026-06-08'])), 32);
  });
  test('needs at least 2 gaps', () => {
    assert.equal(usualIntervalDays(item(['2026-09-11', '2026-08-09'])), null);
    assert.equal(usualIntervalDays(item(['2026-09-11'])), null);
  });
  test('counts calendar days across month ends', () => {
    assert.deepEqual(gapsNewestFirst(item(['2026-03-01', '2026-02-01'])), [28]);
  });
});

describe('same-day check', () => {
  test('hasEntryOn', () => {
    assert.equal(hasEntryOn(HAIRCUT, '2026-09-11'), true);
    assert.equal(hasEntryOn(HAIRCUT, TODAY), false);
  });
});
