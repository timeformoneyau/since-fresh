/**
 * Tests for sync on return to the app: the throttle and what is said.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSyncOnResume, resumeSyncMessage, RESUME_SYNC_MIN_GAP_MS } from './resume.ts';
import { SYNC_COPY } from './backupStatus.ts';

const NOW = Date.parse('2026-10-21T09:00:00Z');

describe('shouldSyncOnResume', () => {
  test('syncs when nothing has synced yet this session', () => {
    assert.equal(shouldSyncOnResume(null, NOW, false), true);
  });

  test('skips within a few minutes of the last sync', () => {
    assert.equal(shouldSyncOnResume(NOW - 60_000, NOW, false), false);
    assert.equal(shouldSyncOnResume(NOW - RESUME_SYNC_MIN_GAP_MS + 1, NOW, false), false);
  });

  test('syncs once the gap has passed', () => {
    assert.equal(shouldSyncOnResume(NOW - RESUME_SYNC_MIN_GAP_MS, NOW, false), true);
  });

  test('never starts a second sync while one is running', () => {
    assert.equal(shouldSyncOnResume(null, NOW, true), false);
    assert.equal(shouldSyncOnResume(NOW - 60 * 60_000, NOW, true), false);
  });
});

describe('resumeSyncMessage', () => {
  test('quiet on success, offline, signed out, skipped or not run', () => {
    for (const outcome of ['synced', 'offline', 'signed-out', 'skipped', null] as const) {
      assert.equal(resumeSyncMessage(outcome, false), null);
    }
  });

  test('a calm message on a real failure, once', () => {
    assert.equal(resumeSyncMessage('error', false), SYNC_COPY.error);
    assert.equal(resumeSyncMessage('error', true), null);
  });
});
