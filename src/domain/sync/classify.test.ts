/**
 * Tests for sync failure classification (F5) and the backup status copy.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncError } from './classify.ts';
import { describeLastBackup, describeSyncOutcome, SYNC_COPY } from './backupStatus.ts';

/** Shaped like an AuthApiError from auth-js. */
function authApiError(code: string | undefined, status: number) {
  return Object.assign(new Error('raw supabase text'), { name: 'AuthApiError', code, status });
}

/** Shaped like a PostgrestError, which carries no status. */
function postgrestError(code: string, message = 'raw postgrest text') {
  return Object.assign(new Error(message), { name: 'PostgrestError', code });
}

describe('classifySyncError — offline', () => {
  test('auth-js retryable fetch error', () => {
    const e = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
    assert.equal(classifySyncError(e), 'offline');
  });

  test('bare React Native fetch failure', () => {
    assert.equal(classifySyncError(new TypeError('Network request failed')), 'offline');
  });

  for (const prefix of ['TypeError', 'FetchError', 'AbortError']) {
    test(`postgrest-js fetch failure (${prefix})`, () => {
      assert.equal(classifySyncError(postgrestError('', `${prefix}: Network request failed`)), 'offline');
    });
  }
});

describe('classifySyncError — signed-out', () => {
  for (const code of [
    'session_not_found',
    'session_expired',
    'refresh_token_not_found',
    'refresh_token_already_used',
    'user_not_found',
    'bad_jwt',
  ]) {
    test(`auth code ${code}`, () => {
      assert.equal(classifySyncError(authApiError(code, 400)), 'signed-out');
    });
  }

  for (const code of ['PGRST301', 'PGRST303']) {
    test(`PostgREST JWT rejection ${code}`, () => {
      assert.equal(classifySyncError(postgrestError(code)), 'signed-out');
    });
  }

  test('session missing', () => {
    const e = Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 });
    assert.equal(classifySyncError(e), 'signed-out');
  });

  test('any other 401 or 403 from auth', () => {
    assert.equal(classifySyncError(authApiError(undefined, 401)), 'signed-out');
    assert.equal(classifySyncError(authApiError('not_admin', 403)), 'signed-out');
  });
});

describe('classifySyncError — error', () => {
  test('a server or schema error', () => {
    assert.equal(classifySyncError(postgrestError('42P01')), 'error');
  });

  test('a row-level security rejection', () => {
    assert.equal(classifySyncError(postgrestError('42501')), 'error');
  });

  test('other auth errors keep their meaning', () => {
    assert.equal(classifySyncError(authApiError('unexpected_failure', 500)), 'error');
    assert.equal(classifySyncError(authApiError('over_request_rate_limit', 429)), 'error');
  });

  test('a 401 or 403 that is not from auth', () => {
    assert.equal(classifySyncError(Object.assign(new Error('x'), { status: 401 })), 'error');
  });

  test('a TypeError from a bug is not a network failure', () => {
    assert.equal(classifySyncError(new TypeError("Cannot read properties of undefined (reading 'id')")), 'error');
  });

  test('non-objects', () => {
    assert.equal(classifySyncError(undefined), 'error');
    assert.equal(classifySyncError('offline'), 'error');
  });
});

describe('backup status copy', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  test('never synced', () => {
    assert.equal(describeLastBackup(null, now), SYNC_COPY.notYet);
    assert.equal(describeLastBackup('not a date', now), SYNC_COPY.notYet);
  });

  test('relative times', () => {
    assert.equal(describeLastBackup(ago(20_000), now), 'Last backed up just now');
    assert.equal(describeLastBackup(ago(60_000), now), 'Last backed up 1 minute ago');
    assert.equal(describeLastBackup(ago(45 * 60_000), now), 'Last backed up 45 minutes ago');
    assert.equal(describeLastBackup(ago(3 * 3_600_000), now), 'Last backed up 3 hours ago');
    assert.equal(describeLastBackup(ago(26 * 3_600_000), now), 'Last backed up 1 day ago');
  });

  test('a clock behind the stored time reads as just now', () => {
    assert.equal(describeLastBackup(ago(-60_000), now), 'Last backed up just now');
  });

  test('one plain line per outcome', () => {
    assert.equal(describeSyncOutcome('offline'), "You're offline. Changes are saved here and will back up later.");
    assert.equal(describeSyncOutcome('error'), "Couldn't back up just now. Your changes are safe on this phone.");
    assert.equal(describeSyncOutcome('signed-out'), "You've been signed out. Sign in again to keep backing up.");
    assert.equal(describeSyncOutcome('synced'), SYNC_COPY.synced);
    assert.equal(describeSyncOutcome('skipped'), SYNC_COPY.skipped);
  });
});
