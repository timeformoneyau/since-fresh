/**
 * Tests for "until it's due": date items, their due date after Done, and how
 * much notice "coming up" gives.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDueDate,
  isDateItem,
  lastDoneOf,
  nextDueOf,
  comingUpDays,
  rollForward,
  dueDateAfterDone,
  quickPickDate,
  addedDay,
} from './due.ts';
import { formatStorage } from '../../utils/dateUtils.ts';
import type { SinceItem } from '../../types';

function item(over: Partial<SinceItem> = {}): SinceItem {
  return {
    id: 'i', name: 'Car rego', category: 'Auto', lastDoneDate: '2026-10-25', history: [],
    repeatValue: 1, repeatUnit: 'years', createdAt: '2026-10-25T01:00:00.000Z', updatedAt: '2026-10-25T01:00:00.000Z',
    dueDate: '2026-12-05', ...over,
  };
}

describe('isDueDate', () => {
  test('real YYYY-MM-DD dates only', () => {
    assert.equal(isDueDate('2026-12-05'), true);
    assert.equal(isDueDate('2028-02-29'), true);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-1-5', '5 Dec 2026', '', null, undefined, 20261205]) {
      assert.equal(isDueDate(bad), false, String(bad));
    }
  });
});

describe('date items', () => {
  test('a date item is one with a due date; others are "since" items', () => {
    assert.equal(isDateItem(item()), true);
    assert.equal(isDateItem(item({ dueDate: null })), false);
    assert.equal(isDateItem(item({ dueDate: undefined })), false);
  });

  test('not done yet until it has an entry', () => {
    assert.equal(lastDoneOf(item()), null);
    assert.equal(lastDoneOf(item({ lastDoneDate: '2026-12-01', history: [{ id: 'e', date: '2026-12-01' }] })), '2026-12-01');
  });

  test('its due date is the one set, not last done plus the repeat', () => {
    assert.equal(formatStorage(nextDueOf(item())!), '2026-12-05');
    // Without one: last done + repeat, as before
    const since = item({ dueDate: undefined, lastDoneDate: '2026-01-10', history: [{ id: 'e', date: '2026-01-10' }] });
    assert.equal(formatStorage(nextDueOf(since)!), '2027-01-10');
    assert.equal(nextDueOf({ ...since, repeatValue: null, repeatUnit: null }), null);
    // A one-off date item still has a due date
    assert.equal(formatStorage(nextDueOf(item({ repeatValue: null, repeatUnit: null }))!), '2026-12-05');
  });

  test('the day added is the local date of createdAt', () => {
    const at = new Date(2026, 9, 25, 23, 30);
    assert.equal(addedDay(item({ createdAt: at.toISOString() })), '2026-10-25');
    assert.equal(addedDay(item({ createdAt: 'nonsense' })), '2026-10-25');
  });
});

describe('Done on a date item', () => {
  test('repeating: the previous due date plus the repeat, so renewing early keeps the cycle', () => {
    assert.equal(rollForward('2026-12-05', 1, 'years', '2026-10-25'), '2027-12-05');
    assert.equal(rollForward('2026-12-05', 1, 'years', '2026-12-05'), '2027-12-05');
  });

  test('done late: rolled forward until it is after today', () => {
    assert.equal(rollForward('2026-12-05', 1, 'years', '2026-12-20'), '2027-12-05');
    assert.equal(rollForward('2024-12-05', 1, 'years', '2026-12-20'), '2027-12-05');
    assert.equal(rollForward('2026-10-01', 2, 'weeks', '2026-10-30'), '2026-11-12');
  });

  test('months count from the original date, so the end of the month never drifts', () => {
    assert.equal(rollForward('2026-01-31', 1, 'months', '2026-02-01'), '2026-02-28');
    assert.equal(rollForward('2026-01-31', 1, 'months', '2026-03-01'), '2026-03-31');
  });

  test('one-off: the due date clears and it becomes a once-off record', () => {
    assert.equal(dueDateAfterDone(item({ repeatValue: null, repeatUnit: null }), '2026-11-01'), null);
    assert.equal(dueDateAfterDone(item(), '2026-11-01'), '2027-12-05');
    assert.equal(dueDateAfterDone(item({ dueDate: undefined }), '2026-11-01'), null);
  });
});

describe('coming up', () => {
  test('"since" items keep the thresholds they had', () => {
    const since = (value: number, unit: SinceItem['repeatUnit']) =>
      comingUpDays(item({ dueDate: undefined, repeatValue: value, repeatUnit: unit, history: [{ id: 'e', date: '2026-10-25' }] }));
    assert.equal(since(7, 'days'), 1);
    assert.equal(since(1, 'months'), 3);
    assert.equal(since(3, 'months'), 7);
    assert.equal(since(6, 'months'), 14);
    assert.equal(since(1, 'years'), 30);
    assert.equal(since(2, 'years'), 45);
  });

  test('date items get at least a week', () => {
    // Yearly: 30 days, as a yearly "since" item
    assert.equal(comingUpDays(item()), 30);
    // Repeating every 2 weeks would be 1 day; a date item gets 7
    assert.equal(comingUpDays(item({ repeatValue: 2, repeatUnit: 'weeks' })), 7);
    // One-off, due in 3 months from when it was added: 7
    assert.equal(comingUpDays(item({ repeatValue: null, repeatUnit: null, dueDate: '2027-01-25' })), 7);
    // One-off due 2 years out: 45
    assert.equal(comingUpDays(item({ repeatValue: null, repeatUnit: null, dueDate: '2028-10-25' })), 45);
    // Due in 3 days, or already past: still 7
    assert.equal(comingUpDays(item({ repeatValue: null, repeatUnit: null, dueDate: '2026-10-28' })), 7);
    assert.equal(comingUpDays(item({ repeatValue: null, repeatUnit: null, dueDate: '2026-01-01' })), 7);
  });

  test('a once-off record has none', () => {
    assert.equal(comingUpDays(item({ dueDate: null, repeatValue: null, repeatUnit: null })), null);
  });
});

describe('quick picks', () => {
  test('from today', () => {
    assert.equal(quickPickDate(1, 'months', '2026-10-25'), '2026-11-25');
    assert.equal(quickPickDate(3, 'months', '2026-10-25'), '2027-01-25');
    assert.equal(quickPickDate(1, 'years', '2026-10-25'), '2027-10-25');
  });
});
