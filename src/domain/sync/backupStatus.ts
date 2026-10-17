/**
 * Account-screen copy for backup status (F5). Pure, so it runs under
 * `npm test`.
 */

import type { SyncOutcome } from './runSync';

export const SYNC_COPY = {
  synced: 'Everything is backed up.',
  offline: "You're offline. Changes are saved here and will back up later.",
  error: "Couldn't back up just now. Your changes are safe on this phone.",
  signedOut: "You've been signed out. Sign in again to keep backing up.",
  skipped: "Backup isn't available right now. Your changes are saved here.",
  notYet: 'Not backed up yet',
} as const;

export function describeSyncOutcome(outcome: SyncOutcome): string {
  switch (outcome) {
    case 'synced': return SYNC_COPY.synced;
    case 'offline': return SYNC_COPY.offline;
    case 'error': return SYNC_COPY.error;
    case 'signed-out': return SYNC_COPY.signedOut;
    case 'skipped': return SYNC_COPY.skipped;
  }
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** "Last backed up 5 minutes ago", or "Not backed up yet". */
export function describeLastBackup(lastSyncedAt: string | null, now: Date): string {
  if (!lastSyncedAt) return SYNC_COPY.notYet;
  const then = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(then)) return SYNC_COPY.notYet;

  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60_000);
  if (minutes < 1) return 'Last backed up just now';
  if (minutes < 60) return `Last backed up ${plural(minutes, 'minute')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last backed up ${plural(hours, 'hour')}`;
  const days = Math.floor(hours / 24);
  return `Last backed up ${plural(days, 'day')}`;
}
