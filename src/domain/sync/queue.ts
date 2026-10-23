/**
 * Pending-operation queue for local-first sync.
 *
 * Every mutation writes to AsyncStorage first and records its intent here.
 * The queue drains opportunistically (see engine.ts). Item operations are
 * id-based rather than payload-based: when we finally push, we send whatever
 * the item looks like *now*, so a queue that backed up over several offline
 * edits still results in one correct upsert. History entries are recorded one
 * by one; the rules are in queueOps.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SyncQueue,
  EntryRef,
  EMPTY_QUEUE,
  readQueue,
  withUpsert,
  withDelete,
  withEntryUpsert,
  withEntryDelete,
  withoutPushed,
  withoutItems,
  withParked,
  activeParked,
  isEmpty,
  DeleteMeta,
  ParkedChange,
} from './queueOps';

import { parkedMessage } from './limits';

export type { SyncQueue, EntryRef, DeleteMeta, ParkedChange } from './queueOps';

const QUEUE_KEY = '@since_sync_queue_v1';

export async function loadQueue(): Promise<SyncQueue> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return { ...EMPTY_QUEUE };
    return readQueue(JSON.parse(raw));
  } catch {
    return { ...EMPTY_QUEUE };
  }
}

async function saveQueue(q: SyncQueue): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // Queue persistence is best-effort. A lost queue costs one sync cycle,
    // not data: the first sync after it re-sends every entry (runSync.ts).
  }
}

async function update(change: (q: SyncQueue) => SyncQueue): Promise<void> {
  await saveQueue(change(await loadQueue()));
}

export const enqueueUpsert = (id: string) => update((q) => withUpsert(q, id));
export const enqueueDelete = (id: string, meta?: DeleteMeta) => update((q) => withDelete(q, id, meta));
export const forgetQueuedItems = (ids: string[]) => update((q) => withoutItems(q, ids));
export const enqueueEntryUpsert = (ref: EntryRef) => update((q) => withEntryUpsert(q, ref));
export const enqueueEntryDelete = (ref: EntryRef) => update((q) => withEntryDelete(q, ref));

/**
 * Retire only the operations that were actually pushed.
 *
 * Deliberately not a wholesale clear: a mutation made while a push is in
 * flight enqueues during that window, and clearing everything would discard
 * it with no retry. Removing by id leaves those entries queued for the next
 * run.
 */
export const removeFromQueue = (ops: Partial<SyncQueue>) => update((q) => withoutPushed(q, ops));

/** What the last sync parked (changes the server refused for good, limits.ts). */
export const parkChanges = (parked: Record<string, ParkedChange>) => update((q) => withParked(q, parked));

export async function clearQueue(): Promise<void> {
  await saveQueue({ ...EMPTY_QUEUE });
}

export async function hasPending(): Promise<boolean> {
  return !isEmpty(await loadQueue());
}

/**
 * Items whose change can't sync yet, each with what to tell the person
 * (limits.ts). Only parkings that still apply: an item edited since will
 * try again at the next sync.
 */
export async function parkedMessages(
  items: Array<{ id: string; updatedAt: string }>,
): Promise<Record<string, string>> {
  const q = await loadQueue();
  if (!q.parked) return {};
  const out: Record<string, string> = {};
  for (const item of items) {
    const p = activeParked(q, item);
    if (p) out[item.id] = parkedMessage(p.code);
  }
  return out;
}
