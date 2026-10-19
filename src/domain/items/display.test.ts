import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  chipLabel,
  intervalProgress,
  summaryCounts,
  lastDoneText,
  intervalText,
  repeatText,
  daysAgoText,
  daysAheadText,
  dueCaption,
  entryCaption,
  historySummary,
} from './display.ts';
import type { ItemStatus } from '../../types';

const status = (s: Partial<ItemStatus>): ItemStatus => ({
  label: 'All good',
  daysSince: 0,
  daysUntilDue: 30,
  nextDueDate: null,
  ...s,
});

describe('chipLabel', () => {
  test('shows the status, or "Once off" with no repeat', () => {
    assert.equal(chipLabel('Getting overdue'), 'Getting overdue');
    assert.equal(chipLabel(null), 'Once off');
  });
});

describe('intervalProgress', () => {
  test('elapsed over interval', () => {
    assert.equal(intervalProgress(status({ daysSince: 6, daysUntilDue: 24 })), 0.2);
  });
  test('clamped to 1 when overdue', () => {
    assert.equal(intervalProgress(status({ label: 'Getting overdue', daysSince: 38, daysUntilDue: -8 })), 1);
  });
  test('0 on the day it was done', () => {
    assert.equal(intervalProgress(status({ daysSince: 0, daysUntilDue: 30 })), 0);
  });
  test('no bar for once-off items', () => {
    assert.equal(intervalProgress(status({ label: null, daysUntilDue: null })), null);
  });
});

describe('summaryCounts', () => {
  test('counts items that could use a look and ones coming up', () => {
    assert.equal(
      summaryCounts(['Long overdue', "It's been a while", 'Coming up', 'About now', 'All good', null]),
      '2 could use a look · 2 coming up',
    );
  });
  test('only the parts that apply', () => {
    assert.equal(summaryCounts(['Getting overdue', 'All good']), '1 could use a look');
    assert.equal(summaryCounts(['Coming up']), '1 coming up');
  });
  test('omitted when everything is all good or once off', () => {
    assert.equal(summaryCounts(['All good', null]), null);
  });
});

describe('lastDoneText', () => {
  test('today, yesterday and days ago', () => {
    assert.equal(lastDoneText(0), 'Done today');
    assert.equal(lastDoneText(1), 'Last done yesterday');
    assert.equal(lastDoneText(38), 'Last done 38 days ago');
  });
});

describe('item screen wording', () => {
  test('repeat subtitle', () => {
    assert.equal(repeatText(30, 'days'), 'Repeats every 30 days');
    assert.equal(repeatText(1, 'years'), 'Repeats every year');
    assert.equal(repeatText(null, null), 'Once off');
    assert.equal(intervalText(1, 'weeks'), '1 week');
  });
  test('days ago and ahead', () => {
    assert.equal(daysAgoText(0), 'today');
    assert.equal(daysAgoText(1), 'yesterday');
    assert.equal(daysAgoText(38), '38 days ago');
    assert.equal(daysAheadText(1), 'tomorrow');
    assert.equal(daysAheadText(24), 'in 24 days');
  });
  test('due marker caption', () => {
    assert.equal(dueCaption(-8, 30, 'days'), '30 days after your last one. Still waiting.');
    assert.equal(dueCaption(0, 30, 'days'), '30 days after your last one. Still waiting.');
    assert.equal(dueCaption(24, 30, 'days'), 'Due in 24 days');
  });
  test('entry captions', () => {
    assert.equal(entryCaption(null), 'First time · when you started tracking');
    assert.equal(entryCaption(33), 'Done again · 33 days after the last');
    assert.equal(entryCaption(1), 'Done again · 1 day after the last');
    assert.equal(entryCaption(0), 'Done again · same day as the last');
  });
  test('history summary', () => {
    assert.equal(historySummary(4, 32), '4 entries · about every 32 days');
    assert.equal(historySummary(1, null), '1 entry');
  });
});
