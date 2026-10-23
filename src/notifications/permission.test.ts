/**
 * When to ask for notification permission (permission.ts).
 * Run with:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldExplain,
  shouldShowOffNotice,
  turnOnAction,
  readPermission,
  readPrefs,
  REMINDERS_COPY,
} from './permission.ts';

const off = { granted: false, canAskAgain: true };
const on = { granted: true, canAskAgain: true };
const blocked = { granted: false, canAskAgain: false };

test('explained once, on saving a repeating item, only while reminders are off', () => {
  assert.equal(shouldExplain(off, {}, true), true);
  assert.equal(shouldExplain(off, {}, false), false, 'a once-off item needs no reminders');
  assert.equal(shouldExplain(on, {}, true), false, 'already on');
  assert.equal(shouldExplain(off, { explained: true }, true), false, 'never asked twice, whatever the answer was');
  assert.equal(shouldExplain(blocked, {}, true), true, 'still explained; the button then opens settings');
});

test('the list notice: reminders off, something repeats, not hidden', () => {
  assert.equal(shouldShowOffNotice(off, {}, true), true);
  assert.equal(shouldShowOffNotice(blocked, { explained: true }, true), true);
  assert.equal(shouldShowOffNotice(off, {}, false), false, 'nothing to remind about');
  assert.equal(shouldShowOffNotice(on, {}, true), false);
  assert.equal(shouldShowOffNotice(off, { noticeDismissed: true }, true), false, 'hidden for good');
});

test("Turn on asks while Android still shows its prompt, then sends to settings", () => {
  assert.equal(turnOnAction(off), 'ask');
  assert.equal(turnOnAction(blocked), 'settings');
});

test('permission as expo-notifications reports it, read defensively', () => {
  assert.deepEqual(readPermission({ status: 'granted', granted: true, canAskAgain: true }), on);
  assert.deepEqual(readPermission({ status: 'denied', granted: false, canAskAgain: false }), blocked);
  assert.deepEqual(readPermission({ status: 'undetermined', canAskAgain: true }), off);
  assert.deepEqual(readPermission({ status: 'granted' }), on, 'older shape: status only');
  assert.deepEqual(readPermission(undefined), off);
});

test('stored answers: missing or unreadable means not yet', () => {
  assert.deepEqual(readPrefs(undefined), {});
  assert.deepEqual(readPrefs({ explained: 'yes', noticeDismissed: 1 }), {});
  assert.deepEqual(readPrefs({ explained: true, noticeDismissed: true, other: 1 }), { explained: true, noticeDismissed: true });
});

test('the words are calm', () => {
  assert.match(REMINDERS_COPY.body, /so we can remind you when something comes round/i);
  assert.equal(REMINDERS_COPY.offNotice, "Reminders are off, so Since can't nudge you. Turn them on in settings.");
  for (const copy of Object.values(REMINDERS_COPY)) assert.ok(!copy.includes('!'), copy);
});
