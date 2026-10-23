/**
 * Tests for auth error copy (F9), the password minimum (F11) and the resend
 * cooldown.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyAuthError, isEmailTaken, AUTH_COPY, MIN_PASSWORD_LENGTH } from './errors.ts';
import { secondsUntilResend, isValidCodeFormat, RESEND_COOLDOWN_SECONDS } from './cooldown.ts';

/** Shaped like an AuthApiError from auth-js. */
function apiError(code: string | undefined, status = 400, message = 'raw supabase text') {
  return Object.assign(new Error(message), { name: 'AuthApiError', code, status });
}

describe('friendlyAuthError', () => {
  const cases: Array<[string, string]> = [
    ['invalid_credentials', AUTH_COPY.invalidCredentials],
    ['email_not_confirmed', AUTH_COPY.emailNotConfirmed],
    ['user_already_exists', AUTH_COPY.userExists],
    ['email_exists', AUTH_COPY.userExists],
    ['weak_password', AUTH_COPY.weakPassword],
    ['same_password', AUTH_COPY.samePassword],
    ['over_request_rate_limit', AUTH_COPY.rateLimited],
    ['over_email_send_rate_limit', AUTH_COPY.rateLimited],
    ['otp_expired', AUTH_COPY.badCode],
  ];
  for (const [code, copy] of cases) {
    test(`maps ${code}`, () => {
      assert.equal(friendlyAuthError(apiError(code)), copy);
    });
  }

  test('maps by code, not message text', () => {
    assert.equal(
      friendlyAuthError(apiError('invalid_credentials', 400, 'Email not confirmed')),
      AUTH_COPY.invalidCredentials,
    );
  });

  test('maps a retryable fetch failure to the network copy', () => {
    const e = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
    assert.equal(friendlyAuthError(e), AUTH_COPY.network);
  });

  test('maps a bare React Native fetch failure to the network copy', () => {
    assert.equal(friendlyAuthError(new TypeError('Network request failed')), AUTH_COPY.network);
  });

  test('maps an uncoded 429 to the rate-limit copy', () => {
    assert.equal(friendlyAuthError(apiError(undefined, 429)), AUTH_COPY.rateLimited);
  });

  test('falls back for unknown codes, plain errors and non-errors', () => {
    assert.equal(friendlyAuthError(apiError('unexpected_failure', 500)), AUTH_COPY.fallback);
    assert.equal(friendlyAuthError(new Error('boom')), AUTH_COPY.fallback);
    assert.equal(friendlyAuthError('boom'), AUTH_COPY.fallback);
    assert.equal(friendlyAuthError(null), AUTH_COPY.fallback);
    assert.equal(friendlyAuthError(undefined), AUTH_COPY.fallback);
  });

  test('never shows the raw Supabase message', () => {
    for (const code of ['invalid_credentials', 'otp_expired', 'nope']) {
      assert.notEqual(friendlyAuthError(apiError(code)), 'raw supabase text');
    }
  });
});

test('password minimum is 8', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

describe('secondsUntilResend', () => {
  const t0 = 1_000_000;
  test('no code sent yet: can send now', () => {
    assert.equal(secondsUntilResend(null, t0), 0);
  });
  test('just sent: full cooldown', () => {
    assert.equal(secondsUntilResend(t0, t0), RESEND_COOLDOWN_SECONDS);
  });
  test('rounds partial seconds up', () => {
    assert.equal(secondsUntilResend(t0, t0 + 500), 60);
    assert.equal(secondsUntilResend(t0, t0 + 59_001), 1);
  });
  test('reaches zero at the cooldown and stays there', () => {
    assert.equal(secondsUntilResend(t0, t0 + 60_000), 0);
    assert.equal(secondsUntilResend(t0, t0 + 120_000), 0);
  });
  test('custom cooldown', () => {
    assert.equal(secondsUntilResend(t0, t0 + 1_000, 10), 9);
  });
});

describe('isValidCodeFormat', () => {
  test('accepts 6 to 8 digits', () => {
    assert.ok(isValidCodeFormat('123456'));
    assert.ok(isValidCodeFormat('1234567'));
    assert.ok(isValidCodeFormat('12345678'));
  });
  test('rejects too short, too long and non-digits', () => {
    assert.ok(!isValidCodeFormat('12345'));
    assert.ok(!isValidCodeFormat('123456789'));
    assert.ok(!isValidCodeFormat('12a456'));
    assert.ok(!isValidCodeFormat(''));
  });
});

describe('friendlyAuthError — change email', () => {
  test("an address held by another account isn't revealed: it reads as a wrong code", () => {
    assert.equal(friendlyAuthError(apiError('email_exists', 422), 'change-email'), AUTH_COPY.badCode);
    assert.equal(friendlyAuthError(apiError('user_already_exists', 422), 'change-email'), AUTH_COPY.badCode);
    assert.ok(isEmailTaken(apiError('email_exists', 422)));
    assert.ok(isEmailTaken(apiError('user_already_exists', 422)));
    assert.ok(!isEmailTaken(apiError('email_address_invalid', 400)));
    assert.ok(!Object.values(AUTH_COPY).some((copy) => /already used by another account/.test(copy)));
  });

  test('outside change email the sign-up copy stands', () => {
    assert.equal(friendlyAuthError(apiError('email_exists', 422)), AUTH_COPY.userExists);
  });

  test('an invalid address', () => {
    assert.equal(friendlyAuthError(apiError('email_address_invalid', 400), 'change-email'), AUTH_COPY.invalidEmail);
  });
});
