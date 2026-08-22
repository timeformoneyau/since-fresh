/**
 * Local-first background sync (decision D1, option B).
 *
 * Contract:
 *   - Every write lands in AsyncStorage first and always succeeds, online or
 *     off. The UI never waits on the network and never fails because of it.
 *   - Sync is opportunistic: mutations fire it and forget, and it also runs on
 *     app start, on sign-in, and when the list regains focus.
 *   - Signed out, or with no credentials configured, the app is simply a
 *     local-only app. Sync no-ops rather than erroring.
 *
 * Conflict resolution — last-write-wins per item, on `updatedAt`:
 *   - Item present both sides: the higher updatedAt wins outright.
 *   - Item only in cloud: adopted locally (another device created it).
 *   - Item only local: pushed if queued; otherwise treated as a remote
 *     deletion and dropped, which is what makes tombstones necessary.
 *   - Tombstoned id: deletion is final and wins over any edit. Deleting is a
 *     deliberate act, and resurrecting an item the user removed is a worse
 *     failure than losing a concurrent edit to it.
 *
 * Item-level, not field-level: two devices editing different fields of the
 * same item within one sync window will keep only the later edit. Acceptable
 * for a single-user app; revisit if sharing is ever added.
 */

import { SinceItem } from '../../types';
import { loadItems, saveItems } from '../items/storage';
import {
  cloudLoadItems,
  cloudUpsertMany,
  cloudDeleteMany,
  cloudLoadTombstones,
} from '../items/cloudStorage';
import { isCloudSyncConfigured, getSupabase } from '../../lib/supabase';
import { loadQueue, clearQueue } from './queue';
import { rescheduleAllNotifications } from '../../notifications/scheduler';

export type SyncOutcome = 'synced' | 'skipped' | 'offline';

/** Guards against overlapping runs — mutations can fire this rapidly. */
let inFlight: Promise<SyncOutcome> | null = null;

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

/**
 * Merge cloud state into local state by last-write-wins, honouring tombstones.
 * Pure — takes and returns plain arrays so it can be reasoned about directly.
 */
export function mergeItems(
  local: SinceItem[],
  cloud: SinceItem[],
  tombstoned: Set<string>,
  pendingUpserts: Set<string>,
): SinceItem[] {
  const byId = new Map<string, SinceItem>();

  for (const item of cloud) {
    if (tombstoned.has(item.id)) continue;
    byId.set(item.id, item);
  }

  for (const item of local) {
    if (tombstoned.has(item.id)) continue;

    const remote = byId.get(item.id);
    if (!remote) {
      // Only local. Keep it if it is still waiting to be pushed; otherwise it
      // was deleted elsewhere and the tombstone has already been pruned.
      if (pendingUpserts.has(item.id)) byId.set(item.id, item);
      continue;
    }

    if (item.updatedAt > remote.updatedAt) byId.set(item.id, item);
  }

  return [...byId.values()];
}

/**
 * Push pending local changes, pull remote state, merge, persist, reschedule.
 * Never throws — a failed sync leaves local state untouched and the queue
 * intact for the next attempt.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<SyncOutcome> => {
    if (!isCloudSyncConfigured()) return 'skipped';
    if (!(await isAuthenticated())) return 'skipped';

    try {
      const queue = await loadQueue();
      const local = await loadItems();

      // ─── Push ───────────────────────────────────────────────────────────
      if (queue.upserts.length > 0) {
        const byId = new Map(local.map((i) => [i.id, i]));
        const toPush = queue.upserts
          .map((id) => byId.get(id))
          .filter((i): i is SinceItem => i !== undefined);
        await cloudUpsertMany(toPush);
      }

      if (queue.deletes.length > 0) {
        await cloudDeleteMany(queue.deletes);
      }

      // Only clear once both pushes succeeded — a throw above leaves the
      // queue intact so nothing is silently dropped.
      await clearQueue();

      // ─── Pull and merge ─────────────────────────────────────────────────
      const [cloud, tombstones] = await Promise.all([
        cloudLoadItems(),
        cloudLoadTombstones(),
      ]);

      const merged = mergeItems(
        local,
        cloud,
        new Set(tombstones),
        new Set(queue.upserts),
      );

      await saveItems(merged);
      await rescheduleAllNotifications(merged);

      return 'synced';
    } catch {
      // Offline, auth expired, or server error. Local state and queue are
      // untouched; the next trigger retries.
      return 'offline';
    }
  })();

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
 * On first sign-in, push everything held locally so pre-account data is
 * adopted into the new account rather than stranded on the device.
 */
export async function adoptLocalItemsIntoAccount(): Promise<void> {
  if (!isCloudSyncConfigured()) return;
  if (!(await isAuthenticated())) return;

  try {
    const local = await loadItems();
    if (local.length > 0) await cloudUpsertMany(local);
  } catch {
    // Stays local; the queue-driven sync will retry.
  }
  await syncNow();
}
