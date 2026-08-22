/**
 * Pending-operation queue for local-first sync.
 *
 * Every mutation writes to AsyncStorage first and records its intent here.
 * The queue drains opportunistically (see engine.ts). It is deliberately
 * id-based rather than payload-based: when we finally push, we send whatever
 * the item looks like *now*, so a queue that backed up over several offline
 * edits still results in one correct upsert.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = '@since_sync_queue_v1';

export interface SyncQueue {
  /** Item ids created or modified locally and not yet pushed. */
  upserts: string[];
  /** Item ids deleted locally and not yet pushed. */
  deletes: string[];
}

const EMPTY: SyncQueue = { upserts: [], deletes: [] };

export async function loadQueue(): Promise<SyncQueue> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SyncQueue>;
    return {
      upserts: Array.isArray(parsed.upserts) ? parsed.upserts : [],
      deletes: Array.isArray(parsed.deletes) ? parsed.deletes : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function saveQueue(q: SyncQueue): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // Queue persistence is best-effort. A lost queue costs one sync cycle,
    // not data: the full-state pull reconciles anything missed.
  }
}

export async function enqueueUpsert(id: string): Promise<void> {
  const q = await loadQueue();
  if (!q.upserts.includes(id)) q.upserts.push(id);
  // A recreated id is no longer deleted.
  q.deletes = q.deletes.filter((d) => d !== id);
  await saveQueue(q);
}

export async function enqueueDelete(id: string): Promise<void> {
  const q = await loadQueue();
  if (!q.deletes.includes(id)) q.deletes.push(id);
  // Delete supersedes any pending upsert for the same id.
  q.upserts = q.upserts.filter((u) => u !== id);
  await saveQueue(q);
}

/**
 * Retire only the operations that were actually pushed.
 *
 * Deliberately not a wholesale clear: a mutation made while a push is in
 * flight enqueues during that window, and clearing everything would discard
 * it with no retry. Removing by id leaves those entries queued for the next
 * run.
 */
export async function removeFromQueue(ops: SyncQueue): Promise<void> {
  const q = await loadQueue();
  const doneUpserts = new Set(ops.upserts);
  const doneDeletes = new Set(ops.deletes);
  await saveQueue({
    upserts: q.upserts.filter((id) => !doneUpserts.has(id)),
    deletes: q.deletes.filter((id) => !doneDeletes.has(id)),
  });
}

export async function clearQueue(): Promise<void> {
  await saveQueue({ ...EMPTY });
}

export async function hasPending(): Promise<boolean> {
  const q = await loadQueue();
  return q.upserts.length > 0 || q.deletes.length > 0;
}
