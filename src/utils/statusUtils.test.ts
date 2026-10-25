/**
 * Tests for the status of date items ("until it's due") next to "since"
 * items. Dates are relative to today, as the status is.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { format, addDays } from 'date-fns';
import { computeItemStatus, sortItems, secondaryLine } from './statusUtils.ts';
import { intervalProgress } from '../domain/items/display.ts';
import type { SinceItem } from '../types';

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd');

function dated(id: string, dueIn: number, addedAgo = 0, over: Partial<SinceItem> = {}): SinceItem {
  return {
    id, name: id, category: 'Auto', lastDoneDate: day(-addedAgo), history: [],
    repeatValue: null, repeatUnit: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    dueDate: day(dueIn), ...over,
  };
}

function since(id: string, doneAgo: number, value: number | null, unit: SinceItem['repeatUnit']): SinceItem {
  return {
    id, name: id, category: 'Health', lastDoneDate: day(-doneAgo), history: [{ id: `${id}-e`, date: day(-doneAgo) }],
    repeatValue: value, repeatUnit: unit, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

describe('status of a date item', () => {
  test('the six labels, against the due date', () => {
    const label = (dueIn: number) => computeItemStatus(dated('x', dueIn, 100)).label;
    assert.equal(label(40), 'All good');
    assert.equal(label(7), 'Coming up');
    assert.equal(label(0), 'About now');
    assert.equal(label(-2), 'About now');
    assert.equal(label(-3), "It's been a while");
    assert.equal(label(-20), 'Getting overdue');
    assert.equal(label(-60), 'Long overdue');
  });

  test('"coming up" starts at least a week before', () => {
    // Added today, due in 8 days: a "since" item that short would say Coming up only the day before
    assert.equal(computeItemStatus(dated('x', 8)).label, 'All good');
    assert.equal(computeItemStatus(dated('x', 7)).label, 'Coming up');
  });

  test('the due date is the one set, whatever was last done', () => {
    const s = computeItemStatus(dated('x', 40, 0, { repeatValue: 1, repeatUnit: 'years', lastDoneDate: day(-500) }));
    assert.equal(s.daysUntilDue, 40);
    assert.equal(secondaryLine(s), 'Next in 40 days');
  });

  test('a past due date is overdue', () => {
    assert.equal(secondaryLine(computeItemStatus(dated('x', -5))), 'Overdue by 5 days');
  });

  test('the bar runs from the day it was added to the due date, clamped', () => {
    assert.equal(intervalProgress(computeItemStatus(dated('x', 30, 10))), 0.25);
    assert.equal(intervalProgress(computeItemStatus(dated('x', 30, 0))), 0);
    assert.equal(intervalProgress(computeItemStatus(dated('x', -5, 10))), 1);
    // Added with a past due date
    assert.equal(intervalProgress(computeItemStatus(dated('x', -5, 0))), 1);
  });

  test('a once-off record (one-off, done) has no status, as before', () => {
    assert.equal(computeItemStatus(dated('x', 0, 0, { dueDate: null, history: [{ id: 'e', date: day(0) }] })).label, null);
  });
});

describe('sorting with date items', () => {
  test('date items sort among the others by how due they are; once-off records last', () => {
    const order = sortItems([
      since('record', 3, null, null),
      dated('rego', 40, 0, { repeatValue: 1, repeatUnit: 'years' }),
      since('dentist', 200, 6, 'months'),
      dated('trial', -20),
      dated('licence', 3),
    ]).map((i) => i.id);
    assert.deepEqual(order, ['trial', 'dentist', 'licence', 'rego', 'record']);
  });
});
