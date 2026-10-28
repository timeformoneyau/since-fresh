import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertRepeat } from './repeat.ts';

test('20 days is 3 weeks and 1 month', () => {
  assert.equal(convertRepeat(20, 'days', 'weeks'), 3);
  assert.equal(convertRepeat(20, 'days', 'months'), 1);
});

test('the same unit gives the value back exactly', () => {
  assert.equal(convertRepeat(20, 'days', 'days'), 20);
  assert.equal(convertRepeat(99, 'years', 'years'), 99);
});

test('converts up and down through days', () => {
  assert.equal(convertRepeat(2, 'weeks', 'days'), 14);
  assert.equal(convertRepeat(6, 'months', 'weeks'), 26);
  assert.equal(convertRepeat(1, 'years', 'months'), 12);
  assert.equal(convertRepeat(3, 'months', 'days'), 90);
});

test('rounds to the nearest whole number', () => {
  assert.equal(convertRepeat(10, 'days', 'weeks'), 1); // 1.43
  assert.equal(convertRepeat(11, 'days', 'weeks'), 2); // 1.57
  assert.equal(convertRepeat(45, 'days', 'months'), 2); // 1.5 rounds up
});

test('never goes below 1', () => {
  assert.equal(convertRepeat(1, 'days', 'weeks'), 1); // 0.14
  assert.equal(convertRepeat(3, 'days', 'years'), 1);
  assert.equal(convertRepeat(5, 'months', 'years'), 1); // 0.41
});

test('stops at 99', () => {
  assert.equal(convertRepeat(20, 'weeks', 'days'), 99); // 140
  assert.equal(convertRepeat(2, 'years', 'days'), 99); // 730
  assert.equal(convertRepeat(99, 'years', 'weeks'), 99);
});
