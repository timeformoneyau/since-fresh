/**
 * Tests for snooze ("Not yet") rules and its stored form.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSnooze, snoozeUntil, makeSnooze, activeSnoozeUntil, pruneSnoozes, snoozeNote,
  parseSnoozes, serializeSnoozes,
} from './rules.ts';
import type { SinceItem } from '../../types';

const NOW = new Date(2026, 9, 21, 8, 0); // Wed 21 Oct 2026

function item(id: string, lastDoneDate: string, repeatValue: number | null = 1, repeatUnit: SinceItem['repeatUnit'] = 'months'): SinceItem {
  return {
    id, name: id, category: 'Household', lastDoneDate,
    history: [{ id: `${id}-e`, date: lastDoneDate }],
    repeatValue, repeatUnit, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('when "Not yet" is offered', () => {
  test('due today or overdue only', () => {
    assert.equal(canSnooze(item('due today', '2026-09-21'), NOW), true);
    assert.equal(canSnooze(item('overdue', '2026-08-01'), NOW), true);
    assert.equal(canSnooze(item('tomorrow', '2026-09-22'), NOW), false);
    assert.equal(canSnooze(item('once off', '2026-01-01', null, null), NOW), false);
  });
});

describe('how long', () => {
  test('3 days, 1 week, 1 month from today', () => {
    assert.equal(snoozeUntil('3-days', NOW), '2026-10-24');
    assert.equal(snoozeUntil('1-week', NOW), '2026-10-28');
    assert.equal(snoozeUntil('1-month', NOW), '2026-11-21');
  });
});

describe('while it holds', () => {
  const it = item('Gutters', '2026-09-11');
  const s = { Gutters: makeSnooze(it, '1-week', NOW) };

  test('active up to and including the day it ends', () => {
    assert.equal(activeSnoozeUntil(it, s, NOW), '2026-10-28');
    assert.equal(activeSnoozeUntil(it, s, new Date(2026, 9, 28, 20, 0)), '2026-10-28');
    assert.equal(activeSnoozeUntil(it, s, new Date(2026, 9, 29, 0, 1)), null);
  });

  test('marking done or changing the repeat ends it', () => {
    assert.equal(activeSnoozeUntil({ ...it, lastDoneDate: '2026-10-21' }, s, NOW), null);
    assert.equal(activeSnoozeUntil({ ...it, repeatValue: 2 }, s, NOW), null);
    assert.equal(activeSnoozeUntil({ ...it, repeatUnit: 'weeks' }, s, NOW), null);
  });

  test('pruning drops ended, changed and deleted items', () => {
    const other = item('Filter', '2026-09-11');
    const all = { ...s, Filter: makeSnooze(other, '3-days', NOW), Gone: makeSnooze(item('Gone', '2026-09-11'), '1-week', NOW) };
    assert.deepEqual(Object.keys(pruneSnoozes(all, [it, { ...other, lastDoneDate: '2026-10-21' }], NOW)), ['Gutters']);
  });
});

describe('the note on the card', () => {
  test('calm and short', () => {
    assert.equal(snoozeNote('2026-10-22', NOW), 'Snoozed until tomorrow');
    assert.equal(snoozeNote('2026-10-27', NOW), 'Snoozed until Tuesday');
    assert.equal(snoozeNote('2026-11-21', NOW), 'Snoozed until 21 Nov');
    assert.equal(snoozeNote('2026-10-21', NOW), null);
    assert.equal(snoozeNote(null, NOW), null);
  });
});

describe('stored form', () => {
  test('round trips', () => {
    const s = { Gutters: makeSnooze(item('Gutters', '2026-09-11'), '1-week', NOW) };
    assert.deepEqual(parseSnoozes(serializeSnoozes(s)), s);
  });
});
