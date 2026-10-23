/**
 * Household and invite errors in the app's words (migration 006 hints).
 * Run with:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { householdErrorMessage, joinResultError, HOUSEHOLD_COPY } from './errors.ts';

const pg = (code: string, message: string, hint: string | null = null) => ({ code, message, hint, details: null });

test('each 006 error reads in plain words, by its hint', () => {
  assert.equal(
    householdErrorMessage(pg('P0001', "Too many codes that didn't work. Wait 15 minutes, then try again.", 'since_join_rate_limited')),
    HOUSEHOLD_COPY.rateLimited,
  );
  assert.equal(householdErrorMessage(pg('P0001', 'reworded', 'since_join_busy')), HOUSEHOLD_COPY.joinBusy);
  assert.equal(householdErrorMessage(pg('P0001', 'reworded', 'since_household_full')), HOUSEHOLD_COPY.householdFull);
  assert.equal(householdErrorMessage(pg('P0001', 'reworded', 'since_too_many_invites')), HOUSEHOLD_COPY.tooManyInvites);
});

test('a wrong, revoked or expired code', () => {
  assert.equal(householdErrorMessage(pg('P0002', "That code isn't right or has expired.")), HOUSEHOLD_COPY.wrongCode);
  assert.equal(householdErrorMessage(pg('P0002', '')), HOUSEHOLD_COPY.wrongCode);
});

test("other errors from our own functions keep the server's message; the rest stay calm", () => {
  assert.equal(householdErrorMessage(pg('P0001', "You're already in a household.")), "You're already in a household.");
  assert.equal(householdErrorMessage(pg('42501', 'Only the household\'s owner can invite people.')), "Only the household's owner can invite people.");
  assert.equal(householdErrorMessage(pg('PGRST202', 'x')), HOUSEHOLD_COPY.notSetUp);
  assert.equal(householdErrorMessage(new TypeError('Network request failed')), HOUSEHOLD_COPY.offline);
  assert.equal(householdErrorMessage(undefined), HOUSEHOLD_COPY.offline);
});

test('none of it shouts', () => {
  for (const copy of Object.values(HOUSEHOLD_COPY)) assert.ok(!copy.includes('!'), copy);
});

test('a wrong-code body returned as data is read as the error it is', () => {
  const body = { code: 'P0002', message: "That code isn't right or has expired.", details: null, hint: null };
  assert.deepEqual(joinResultError(body), { code: 'P0002', message: body.message });
  assert.equal(householdErrorMessage(joinResultError(body)), HOUSEHOLD_COPY.wrongCode);
  // A real join returns the household id
  assert.equal(joinResultError('7a1c0c56-0000-4000-8000-000000000000'), null);
  assert.equal(joinResultError(null), null);
});
