/**
 * Tests for the password-recovery hold rules (Phase 3 fix).
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPendingAfter } from './recoveryRules.ts';

describe('recoveryPendingAfter', () => {
  test('an ordinary password sign-in clears a leftover hold', () => {
    assert.equal(recoveryPendingAfter('password-sign-in'), false);
  });

  test('starting with no session clears a leftover hold', () => {
    assert.equal(recoveryPendingAfter('started-without-session'), false);
  });

  test('verifying a recovery code sets the hold', () => {
    assert.equal(recoveryPendingAfter('recovery-verify-started'), true);
  });

  test('the hold is released when recovery ends either way', () => {
    assert.equal(recoveryPendingAfter('recovery-verify-failed'), false);
    assert.equal(recoveryPendingAfter('password-saved'), false);
    assert.equal(recoveryPendingAfter('recovery-abandoned'), false);
  });
});
