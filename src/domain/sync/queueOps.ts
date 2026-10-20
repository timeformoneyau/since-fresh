/**
 * The sync queue's rules — pure, so they run under `npm test`. queue.ts
 * stores the result in AsyncStorage.
 *
 * Item operations are by id: the push sends whatever the item looks like at
 * the time. History entries changed or deleted on this phone are recorded one
 * by one (entryUpserts, entryDeletes), so the push can overwrite or remove
 * just those entries in the cloud and never another phone's.
 *
 * The entry lists were added after the queue first shipped: a stored queue
 * without them reads as empty lists, and older builds ignore them.
 */

export interface EntryRef {
  itemId: string;
  entryId: string;
}

export interface SyncQueue {
  /** Item ids created or modified locally and not yet pushed. */
  upserts: string[];
  /** Item ids deleted locally and not yet pushed. */
  deletes: string[];
  /** History entries added or edited locally and not yet pushed. */
  entryUpserts: EntryRef[];
  /** History entries deleted locally and not yet pushed. */
  entryDeletes: EntryRef[];
}

export const EMPTY_QUEUE: SyncQueue = { upserts: [], deletes: [], entryUpserts: [], entryDeletes: [] };

const sameRef = (a: EntryRef) => (b: EntryRef) => a.itemId === b.itemId && a.entryId === b.entryId;
const isRef = (x: unknown): x is EntryRef =>
  typeof x === 'object' && x !== null &&
  typeof (x as EntryRef).itemId === 'string' && typeof (x as EntryRef).entryId === 'string';
const isId = (x: unknown): x is string => typeof x === 'string';

/** A stored queue, whatever build wrote it. Anything unreadable is dropped, never thrown. */
export function readQueue(parsed: unknown): SyncQueue {
  const q = (parsed ?? {}) as Partial<Record<keyof SyncQueue, unknown>>;
  const list = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
  return {
    upserts: list(q.upserts, isId),
    deletes: list(q.deletes, isId),
    entryUpserts: list(q.entryUpserts, isRef),
    entryDeletes: list(q.entryDeletes, isRef),
  };
}

export function withUpsert(q: SyncQueue, id: string): SyncQueue {
  return {
    ...q,
    upserts: q.upserts.includes(id) ? q.upserts : [...q.upserts, id],
    // A recreated id is no longer deleted.
    deletes: q.deletes.filter((d) => d !== id),
  };
}

export function withDelete(q: SyncQueue, id: string): SyncQueue {
  return {
    upserts: q.upserts.filter((u) => u !== id),
    deletes: q.deletes.includes(id) ? q.deletes : [...q.deletes, id],
    // The item's entries go with it.
    entryUpserts: q.entryUpserts.filter((r) => r.itemId !== id),
    entryDeletes: q.entryDeletes.filter((r) => r.itemId !== id),
  };
}

export function withEntryUpsert(q: SyncQueue, ref: EntryRef): SyncQueue {
  return {
    ...q,
    entryUpserts: q.entryUpserts.some(sameRef(ref)) ? q.entryUpserts : [...q.entryUpserts, ref],
    entryDeletes: q.entryDeletes.filter((r) => !sameRef(ref)(r)),
  };
}

export function withEntryDelete(q: SyncQueue, ref: EntryRef): SyncQueue {
  return {
    ...q,
    // Deleting supersedes an edit that hasn't been pushed.
    entryUpserts: q.entryUpserts.filter((r) => !sameRef(ref)(r)),
    entryDeletes: q.entryDeletes.some(sameRef(ref)) ? q.entryDeletes : [...q.entryDeletes, ref],
  };
}

/**
 * Retire only the operations that were actually pushed. A change made while
 * a push was in flight stays queued for the next run.
 */
export function withoutPushed(q: SyncQueue, pushed: Partial<SyncQueue>): SyncQueue {
  const done = readQueue(pushed);
  const notIn = (refs: EntryRef[]) => (r: EntryRef) => !refs.some(sameRef(r));
  return {
    upserts: q.upserts.filter((id) => !done.upserts.includes(id)),
    deletes: q.deletes.filter((id) => !done.deletes.includes(id)),
    entryUpserts: q.entryUpserts.filter(notIn(done.entryUpserts)),
    entryDeletes: q.entryDeletes.filter(notIn(done.entryDeletes)),
  };
}

export function isEmpty(q: SyncQueue): boolean {
  return q.upserts.length + q.deletes.length + q.entryUpserts.length + q.entryDeletes.length === 0;
}
