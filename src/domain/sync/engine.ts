/**
 * Local-first background sync (decision D1, option B) — platform wiring.
 *
 * Contract:
 *   - Every write lands in AsyncStorage first and always succeeds, online or
 *     off. The UI never waits on the network and never fails because of it.
 *   - Sync is opportunistic: mutations fire it and forget, and it also runs on
 *     app start, on sign-in, and when the list regains focus.
 *   - Signed out, or with no credentials configured, the app is simply a
 *     local-only app. Sync no-ops rather than erroring.
 *
 * The ordering and conflict rules live in runSync.ts, which is pure and
 * tested. This module only supplies the real I/O and guards re-entry.
 */

import { loadItems, saveItems } from '../items/storage';
import {
  cloudLoadItems,
  cloudUpsertMany,
  cloudDeleteMany,
  cloudLoadTombstones,
} from '../items/cloudStorage';
import { isCloudSyncConfigured, getSupabase } from '../../lib/supabase';
import { loadQueue, removeFromQueue, enqueueUpsert } from './queue';
import { rescheduleAllNotifications } from '../../notifications/scheduler';
import { runSync, SyncPorts, SyncOutcome } from './runSync';

export type { SyncOutcome } from './runSync';
export { mergeItems } from './runSync';

async function isAuthenticated(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session !== null;
  } catch {
    return false;
  }
}

const ports: SyncPorts = {
  isConfigured: isCloudSyncConfigured,
  isAuthenticated,
  loadItems,
  saveItems,
  loadQueue,
  removeFromQueue,
  cloudUpsertMany,
  cloudDeleteMany,
  cloudLoadItems,
  cloudLoadTombstones,
  afterMerge: rescheduleAllNotifications,
};

/** Guards against overlapping runs — mutations can fire this rapidly. */
let inFlight: Promise<SyncOutcome> | null = null;

export async function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  inFlight = runSync(ports);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Fire-and-forget trigger for mutation paths. Never blocks the caller. */
export function syncInBackground(): void {
  void syncNow();
}

/**
 * On first sign-in, adopt everything held locally into the new account so
 * pre-account data is not stranded on the device.
 *
 * Enqueues rather than pushing directly: that way a failed upload is retried
 * by the normal queue-driven path instead of being silently lost.
 */
export async function adoptLocalItemsIntoAccount(): Promise<void> {
  if (!isCloudSyncConfigured()) return;
  if (!(await isAuthenticated())) return;

  try {
    const local = await loadItems();
    for (const item of local) {
      await enqueueUpsert(item.id);
    }
  } catch {
    // Nothing enqueued; the next mutation or focus will trigger a sync.
  }

  await syncNow();
}
