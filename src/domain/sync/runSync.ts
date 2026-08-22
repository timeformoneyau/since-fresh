/**
 * Sync orchestration — pure logic, no platform dependencies.
 *
 * All I/O is injected through SyncPorts so the ordering guarantees below can
 * be tested directly, without AsyncStorage, Supabase or React Native. The
 * real wiring lives in engine.ts.
 *
 * Conflict resolution — last-write-wins per item, on `updatedAt`:
 *   - Item present both sides: the higher updatedAt wins outright.
 *   - Item only in cloud: adopted locally (another device created it).
 *   - Item only local: kept. Deletions propagate via tombstones, never by
 *     inferring "absent from cloud means deleted" — that inference is what
 *     made an in-flight mutation look like a remote deletion.
 *   - Tombstoned id: deletion is final and wins over any edit. Deleting is a
 *     deliberate act, and resurrecting an item the user removed is a worse
 *     failure than losing a concurrent edit to it.
 *
 * Item-level, not field-level: two devices editing different fields of the
 * same item within one sync window will keep only the later edit. Acceptable
 * for a single-user app; revisit if sharing is ever added.
 */

import type { SinceItem } from '../../types';

export type SyncOutcome = 'synced' | 'skipped' | 'offline';

export interface QueueSnapshot {
  upserts: string[];
  deletes: string[];
}

export interface SyncPorts {
  isConfigured(): boolean;
  isAuthenticated(): Promise<boolean>;
  loadItems(): Promise<SinceItem[]>;
  saveItems(items: SinceItem[]): Promise<void>;
  loadQueue(): Promise<QueueSnapshot>;
  removeFromQueue(ops: QueueSnapshot): Promise<void>;
  cloudUpsertMany(items: SinceItem[]): Promise<void>;
  cloudDeleteMany(ids: string[]): Promise<void>;
  cloudLoadItems(): Promise<SinceItem[]>;
  cloudLoadTombstones(): Promise<string[]>;
  afterMerge(items: SinceItem[]): Promise<void>;
}

/**
 * Merge cloud state into local state by last-write-wins, honouring tombstones.
 * Pure and total — no I/O, no ordering assumptions.
 */
export function mergeItems(
  local: SinceItem[],
  cloud: SinceItem[],
  tombstoned: Set<string>,
): SinceItem[] {
  const byId = new Map<string, SinceItem>();

  for (const item of cloud) {
    if (tombstoned.has(item.id)) continue;
    byId.set(item.id, item);
  }

  for (const item of local) {
    if (tombstoned.has(item.id)) continue;

    const remote = byId.get(item.id);
    // Local-only items are kept unconditionally. An item that exists locally
    // but not in the cloud is either newly created here or not yet pushed —
    // in both cases dropping it destroys user data.
    if (!remote || item.updatedAt > remote.updatedAt) byId.set(item.id, item);
  }

  return [...byId.values()];
}

/**
 * Push pending local changes, pull remote state, merge, persist.
 *
 * Ordering matters, and is the fix for a data-loss defect where an item
 * created during an in-flight sync was erased:
 *
 *   1. Snapshot the queue, and read items, for the push only.
 *   2. Do all network I/O.
 *   3. Retire only the operations actually pushed.
 *   4. Re-read local state and the queue immediately before merging, so the
 *      write is based on current state rather than a pre-network snapshot.
 *
 * Never throws — a failed sync leaves local state untouched and the queue
 * intact for the next attempt.
 */
export async function runSync(ports: SyncPorts): Promise<SyncOutcome> {
  if (!ports.isConfigured()) return 'skipped';
  if (!(await ports.isAuthenticated())) return 'skipped';

  try {
    // ─── 1. Snapshot what we are about to push ──────────────────────────
    const pushing = await ports.loadQueue();
    const itemsAtPush = await ports.loadItems();

    // ─── 2. Network ─────────────────────────────────────────────────────
    if (pushing.upserts.length > 0) {
      const byId = new Map(itemsAtPush.map((i) => [i.id, i]));
      const toPush = pushing.upserts
        .map((id) => byId.get(id))
        .filter((i): i is SinceItem => i !== undefined);
      await ports.cloudUpsertMany(toPush);
    }

    if (pushing.deletes.length > 0) {
      await ports.cloudDeleteMany(pushing.deletes);
    }

    const [cloud, tombstones] = await Promise.all([
      ports.cloudLoadItems(),
      ports.cloudLoadTombstones(),
    ]);

    // ─── 3. Retire only what was pushed ─────────────────────────────────
    // Anything enqueued while the network calls were in flight stays queued.
    await ports.removeFromQueue(pushing);

    // ─── 4. Commit, against current state ───────────────────────────────
    // Read as late as possible. Everything from here is local and fast; no
    // network call sits between this read and the write.
    const localNow = await ports.loadItems();
    const stillQueued = await ports.loadQueue();

    const merged = mergeItems(
      localNow,
      cloud,
      // A delete that has not been pushed yet must not be undone by the cloud
      // copy that is still present.
      new Set([...tombstones, ...stillQueued.deletes]),
    );

    await ports.saveItems(merged);
    await ports.afterMerge(merged);

    return 'synced';
  } catch {
    // Offline, auth expired, or server error. Local state and queue are
    // untouched; the next trigger retries.
    return 'offline';
  }
}
