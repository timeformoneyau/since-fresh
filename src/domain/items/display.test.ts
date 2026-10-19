import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chipLabel, intervalProgress, summaryCounts, lastDoneText } from './display.ts';
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
