/**
 * Sync on return to the app. Pure, so it runs under `npm test`.
 *
 * Coming back from the background runs a quiet sync, at most once every
 * RESUME_SYNC_MIN_GAP_MS after the last one finished (from any trigger). The
 * list coming into view and Sync now are not throttled.
 */

import type { SyncOutcome } from './runSync.ts';
import { SYNC_COPY } from './backupStatus.ts';

export const RESUME_SYNC_MIN_GAP_MS = 5 * 60_000;

export function shouldSyncOnResume(
  lastFinishedAt: number | null,
  now: number,
  inFlight: boolean,
): boolean {
  if (inFlight) return false;
  if (lastFinishedAt === null) return true;
  return now - lastFinishedAt >= RESUME_SYNC_MIN_GAP_MS;
}

/**
 * What to say after a sync on return, or null to stay quiet. Only a real
 * failure is mentioned, once per session. Offline is normal (changes are
 * safe on the phone), and an expired session has its own notice.
 */
export function resumeSyncMessage(outcome: SyncOutcome | null, alreadyShown: boolean): string | null {
  if (outcome !== 'error' || alreadyShown) return null;
  return SYNC_COPY.error;
}
