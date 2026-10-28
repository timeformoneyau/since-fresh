import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardOverlap } from './keyboard.ts';

test('closed keyboard covers nothing', () => {
  assert.equal(keyboardOverlap(780, null), 0);
});

test('open keyboard covers from its top edge to the bottom of the view', () => {
  // Edge-to-edge: the view reaches the bottom of the screen, the keyboard
  // (280) sits above the nav bar (53)
  assert.equal(keyboardOverlap(780, 447), 333);
});

test('a view the phone already moved above the keyboard needs nothing', () => {
  assert.equal(keyboardOverlap(447, 447), 0);
  assert.equal(keyboardOverlap(400, 447), 0);
});
