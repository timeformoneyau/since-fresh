import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardOverlap } from './keyboard.ts';

// A 780-high screen, a 53 nav bar and a 280 keyboard above it
const open = (top: number) => ({ top, height: 280, screenBottom: 780, belowKeyboard: 53 });

test('closed keyboard covers nothing', () => {
  assert.equal(keyboardOverlap(780, null), 0);
});

test('open keyboard covers from its top edge to the bottom of the view', () => {
  assert.equal(keyboardOverlap(780, open(447)), 333);
});

test('a top edge reported without the nav bar still covers the nav bar too', () => {
  // Android 11+ reports 500 here, but the keyboard takes taps from 447
  assert.equal(keyboardOverlap(780, open(500)), 333);
});

test('a view the phone already moved above the keyboard needs nothing', () => {
  assert.equal(keyboardOverlap(447, open(447)), 0);
  assert.equal(keyboardOverlap(400, open(500)), 0);
});
