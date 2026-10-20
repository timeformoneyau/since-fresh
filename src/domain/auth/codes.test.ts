/**
 * Tests for emailed-code rules (sign in with a code, no password).
 *
 * Run with:  npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTypeFor, codeSentCopy } from './codes.ts';

test('a sign-in code verifies as an email code, for new and existing accounts alike', () => {
  assert.equal(verifyTypeFor('sign_in'), 'email');
});

test('an email-change code verifies as an email change', () => {
  assert.equal(verifyTypeFor('email_change'), 'email_change');
});

test('the code screen says where the code went and what it does', () => {
  assert.equal(
    codeSentCopy('sign_in', 'sam@example.com'),
    "We've emailed a code to sam@example.com. Enter it to sign in.",
  );
  assert.match(codeSentCopy('email_change', 'new@example.com'), /new@example\.com.*switch your account/);
});
