/**
 * Sync orchestration — pure logic, no platform dependencies.
 *
 * All I/O is injected through SyncPorts so the ordering guarantees below can
 * be tested directly, without AsyncStorage, Supabase or React Native. The
 * real wiring lives in engine.ts.
 *
 * Conflict rules. No phone's clock is ever compared: what changed is decided
 * by the server's change time (server_updated_at), and what's pending on this
 * phone by the sync queue.
 *   - History entries are merged one by one, by id, so two phones adding
 *     entries to the same item both keep them. An entry deleted on any phone
 *     (soft deleted in the cloud) is removed everywhere, except that an item
 *     never loses its last entry.
 *   - Item fields (name, category, repeat): a change still waiting to push
 *     from this phone wins; otherwise the cloud's latest copy does. The last
 *     phone to push a field's change wins it.
 *   - An item only in the cloud is adopted; an item only on this phone is
 *     kept. Deletions propagate via tombstones, never by inferring "absent
 *     from cloud means deleted" — that inference is what made an in-flight
 *     mutation look like a remote deletion.
 *   - Tombstoned id: deletion is final and wins over any edit. Resurrecting
 *     an item the user removed is a worse failure than losing a concurrent
 *     edit to it.
 */

import type { SinceItem, CompletionEvent } from '../../types';
import { sortNewestFirst } from '../items/history.ts';
import type { SyncFailure } from './classify';

export type SyncOutcome = 'synced' | 'skipped' | SyncFailure;

export interface EntryRef {
  itemId: string;
  entryId: string;
}

/** The queue as runSync sees it. Entry lists are absent in queues saved before they existed. */
export interface QueueSnapshot {
  upserts: string[];
  deletes: string[];
  /** Whose each deleted item was, when it wasn't this account's own (households). */
  deleteMeta?: Record<string, { ownerId?: string; householdId?: string | null }>;
  entryUpserts?: EntryRef[];
  entryDeletes?: EntryRef[];
}

/** A history entry as stored in the cloud (completion_events). */
export interface CloudEntry {
  itemId: string;
  id: string;
  date: string;
  note: string | null;
  createdAt: string | null;
  deletedAt: string | null;
  serverUpdatedAt: string;
  /** Who recorded it (households: "Done by"). */
  createdBy?: string | null;
}

/** An item as pulled from the cloud, with the server's change time. */
export type CloudItem = SinceItem & { serverUpdatedAt?: string };

/** A history entry to push. */
export interface EntryRow {
  itemId: string;
  /** The item's owner, when it isn't this account (a shared item). */
  ownerId?: string;
  id: string;
  date: string;
  note: string | null;
  createdAt?: string;
}

export interface EntryPush {
  /** Added only if missing; never overwrites what's in the cloud. */
  insertOnly: EntryRow[];
  /** Changed on this phone: overwrites date and note. */
  overwrite: EntryRow[];
  /** Deleted on this phone: soft deleted in the cloud. */
  softDelete: Array<EntryRef & { ownerId?: string }>;
}

/** Server change times reached by the last successful pull, per table. */
export interface SyncCursor {
  items: string | null;
  entries: string | null;
}

export interface SyncPorts {
  isConfigured(): boolean;
  /**
   * False when there is simply no session. Throws when a session existed but
   * could not be refreshed, so the failure is classified rather than skipped.
   */
  isAuthenticated(): Promise<boolean>;
  /** True only when the stored device owner is the signed-in account. */
  isOwnedBySignedInUser(): Promise<boolean>;
  loadItems(): Promise<SinceItem[]>;
  saveItems(items: SinceItem[]): Promise<void>;
  loadQueue(): Promise<QueueSnapshot>;
  removeFromQueue(ops: QueueSnapshot): Promise<void>;
  cloudUpsertMany(items: SinceItem[]): Promise<void>;
  cloudDeleteMany(ids: string[], meta?: QueueSnapshot['deleteMeta']): Promise<void>;
  cloudPushEntries(push: EntryPush): Promise<void>;
  /** Items changed since the cursor time (all when null). */
  cloudLoadItems(since: string | null): Promise<CloudItem[]>;
  /** Entries changed since the cursor time (all when null), optionally only for some items. */
  cloudLoadEntries(since: string | null, itemIds?: string[]): Promise<CloudEntry[]>;
  cloudLoadTombstones(): Promise<string[]>;
  /** The signed-in account's cursor, or null before its first full pull. */
  loadCursor(): Promise<SyncCursor | null>;
  saveCursor(cursor: SyncCursor): Promise<void>;
  afterMerge(items: SinceItem[]): Promise<void>;
  /** Pure: what a thrown error means (classify.ts). */
  classifyError(error: unknown): SyncFailure;
}

const refKey = (itemId: string, entryId: string) => `${itemId}\u0000${entryId}`;

export interface Pending {
  /** Items with a change still to push. */
  items: Set<string>;
  /** Entries (refKey) added or edited here, still to push. */
  entries: Set<string>;
  /** Entries (refKey) deleted here, still to push. */
  deletedEntries: Set<string>;
}

export function pendingFrom(q: QueueSnapshot): Pending {
  return {
    items: new Set(q.upserts),
    entries: new Set((q.entryUpserts ?? []).map((r) => refKey(r.itemId, r.entryId))),
    deletedEntries: new Set((q.entryDeletes ?? []).map((r) => refKey(r.itemId, r.entryId))),
  };
}

const NOTHING_PENDING: Pending = { items: new Set(), entries: new Set(), deletedEntries: new Set() };

function fromCloud(e: CloudEntry): CompletionEvent {
  return {
    id: e.id,
    date: e.date,
    ...(e.note ? { note: e.note } : {}),
    ...(e.createdAt ? { createdAt: e.createdAt } : {}),
    ...(e.createdBy ? { createdBy: e.createdBy } : {}),
  };
}

/** Apply cloud entry changes to one item's history. Never leaves it empty. */
function mergeHistory(
  item: SinceItem,
  changes: CloudEntry[],
  pending: Pending,
): SinceItem {
  if (changes.length === 0) return item;
  let history = [...item.history];

  for (const change of changes) {
    const key = refKey(item.id, change.id);
    // Deleted here and not pushed yet: the cloud copy mustn't bring it back.
    if (pending.deletedEntries.has(key)) continue;
    const at = history.findIndex((e) => e.id === change.id);

    if (change.deletedAt) {
      if (at !== -1 && history.length > 1) history.splice(at, 1);
    } else if (at === -1) {
      history.push(fromCloud(change));
    } else if (!pending.entries.has(key)) {
      history[at] = fromCloud(change);
    }
  }

  const sorted = sortNewestFirst(history);
  return { ...item, history: sorted, lastDoneDate: sorted[0]?.date ?? item.lastDoneDate };
}

/**
 * Merge cloud changes into local state. Pure and total — no I/O.
 *
 * `cloudItems` and `cloudEntries` are what changed in the cloud (since the
 * last pull, or everything on a first pull); `pending` is what this phone has
 * still to push. See the rules at the top of this file.
 */
export function mergeItems(
  local: SinceItem[],
  cloudItems: CloudItem[],
  tombstoned: Set<string>,
  cloudEntries: CloudEntry[] = [],
  pending: Pending = NOTHING_PENDING,
): SinceItem[] {
  const byId = new Map<string, SinceItem>();
  for (const item of local) {
    if (!tombstoned.has(item.id)) byId.set(item.id, item);
  }

  for (const { serverUpdatedAt: _server, ...cloud } of cloudItems) {
    if (tombstoned.has(cloud.id)) continue;
    const mine = byId.get(cloud.id);
    if (!mine) {
      // Another phone created it. Its history comes with it, then the
      // entry changes below bring it up to date.
      byId.set(cloud.id, cloud);
    } else if (!pending.items.has(cloud.id)) {
      // The cloud's fields win; history is merged entry by entry.
      byId.set(cloud.id, { ...cloud, history: mine.history, lastDoneDate: mine.lastDoneDate });
    }
  }

  const entriesByItem = new Map<string, CloudEntry[]>();
  for (const e of cloudEntries) {
    entriesByItem.set(e.itemId, [...(entriesByItem.get(e.itemId) ?? []), e]);
  }
  for (const [itemId, changes] of entriesByItem) {
    const item = byId.get(itemId);
    if (item) byId.set(itemId, mergeHistory(item, changes, pending));
  }

  return [...byId.values()];
}

function toRow(item: SinceItem, e: CompletionEvent): EntryRow {
  return {
    itemId: item.id,
    ...(item.ownerId ? { ownerId: item.ownerId } : {}),
    id: e.id,
    date: e.date,
    note: e.note ?? null,
    ...(e.createdAt ? { createdAt: e.createdAt } : {}),
  };
}

/** What to send for the queued changes, from the items as they are now. */
export function entryPushFor(queue: QueueSnapshot, items: SinceItem[]): EntryPush {
  const byId = new Map(items.map((i) => [i.id, i]));
  const deleting = new Set(queue.deletes);

  // Every entry of a pushed item, insert-only: covers new items, items
  // adopted at sign-in and entries added by builds before entries were
  // queued, without overwriting another phone's edits.
  const insertOnly = queue.upserts
    .map((id) => byId.get(id))
    .filter((i): i is SinceItem => i !== undefined)
    .flatMap((i) => i.history.map((e) => toRow(i, e)));

  const overwrite = (queue.entryUpserts ?? []).flatMap((ref) => {
    const item = byId.get(ref.itemId);
    const entry = item?.history.find((e) => e.id === ref.entryId);
    return item && entry ? [toRow(item, entry)] : [];
  });

  const softDelete = (queue.entryDeletes ?? [])
    .filter((ref) => !deleting.has(ref.itemId))
    .map((ref) => {
      const ownerId = byId.get(ref.itemId)?.ownerId;
      return ownerId ? { ...ref, ownerId } : ref;
    });

  return { insertOnly, overwrite, softDelete };
}

/** Postgres: a row refers to one that doesn't exist (an entry without its item). */
const FOREIGN_KEY_VIOLATION = '23503';

const later = (a: string | null, b: string | undefined | null): string | null => {
  if (!b) return a;
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

/**
 * Push pending local changes, pull remote changes, merge, persist.
 *
 * Ordering matters, and is the fix for a data-loss defect where an item
 * created during an in-flight sync was erased:
 *
 *   1. Snapshot the queue, and read items, for the push only.
 *   2. Do all network I/O: item rows first (entries need their item), then
 *      entries, then deletes; then the pull.
 *   3. Retire only the operations actually pushed.
 *   4. Re-read local state and the queue immediately before merging, so the
 *      write is based on current state rather than a pre-network snapshot.
 *
 * The first sync for an account (no cursor) pulls everything and copies any
 * entries the cloud doesn't have yet, insert-only, for items it already
 * holds. That's how entries recorded before the entries table existed get
 * there.
 *
 * Never throws — a failed sync leaves local state, the queue and the cursor
 * untouched for the next attempt.
 */
export async function runSync(ports: SyncPorts): Promise<SyncOutcome> {
  if (!ports.isConfigured()) return 'skipped';

  try {
    if (!(await ports.isAuthenticated())) return 'skipped';
    // The local list may belong to another account (see ownership.ts). Until
    // the sign-in rule has run, touch nothing: no push, no pull, no write.
    if (!(await ports.isOwnedBySignedInUser())) return 'skipped';

    // ─── 1. Snapshot what we are about to push ──────────────────────────
    const pushing = await ports.loadQueue();
    const itemsAtPush = await ports.loadItems();
    const cursor = await ports.loadCursor();

    // ─── 2. Network ─────────────────────────────────────────────────────
    if (pushing.upserts.length > 0) {
      const byId = new Map(itemsAtPush.map((i) => [i.id, i]));
      const toPush = pushing.upserts
        .map((id) => byId.get(id))
        .filter((i): i is SinceItem => i !== undefined);
      await ports.cloudUpsertMany(toPush);
    }

    const entryPush = entryPushFor(pushing, itemsAtPush);
    if (entryPush.insertOnly.length + entryPush.overwrite.length + entryPush.softDelete.length > 0) {
      try {
        await ports.cloudPushEntries(entryPush);
      } catch (error) {
        // An entry whose item isn't in the cloud (e.g. the queue was lost
        // before the item was pushed): send those items, then try once more.
        if ((error as { code?: unknown })?.code !== FOREIGN_KEY_VIOLATION) throw error;
        const needed = new Set(entryPush.overwrite.map((e) => e.itemId));
        await ports.cloudUpsertMany(itemsAtPush.filter((i) => needed.has(i.id)));
        await ports.cloudPushEntries(entryPush);
      }
    }

    if (pushing.deletes.length > 0) {
      await ports.cloudDeleteMany(pushing.deletes, pushing.deleteMeta);
    }

    const [cloudItems, tombstones] = await Promise.all([
      ports.cloudLoadItems(cursor?.items ?? null),
      ports.cloudLoadTombstones(),
    ]);
    let cloudEntries = await ports.cloudLoadEntries(cursor?.entries ?? null);

    const localIds = new Set(itemsAtPush.map((i) => i.id));
    if (cursor) {
      // An item new to this phone may have entries older than the cursor.
      const arrived = cloudItems.map((i) => i.id).filter((id) => !localIds.has(id));
      if (arrived.length > 0) {
        cloudEntries = [...cloudEntries, ...(await ports.cloudLoadEntries(null, arrived))];
      }
    } else {
      // First sync for this account: copy entries the cloud may not have.
      const inCloud = new Set(cloudItems.map((i) => i.id));
      const alreadySent = new Set(pushing.upserts);
      const backfill = itemsAtPush
        .filter((i) => inCloud.has(i.id) && !alreadySent.has(i.id))
        .flatMap((i) => i.history.map((e) => toRow(i, e)));
      if (backfill.length > 0) {
        await ports.cloudPushEntries({ insertOnly: backfill, overwrite: [], softDelete: [] });
      }
    }

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
      cloudItems,
      // A delete that has not been pushed yet must not be undone by the cloud
      // copy that is still present.
      new Set([...tombstones, ...stillQueued.deletes]),
      cloudEntries,
      pendingFrom(stillQueued),
    );

    await ports.saveItems(merged);
    await ports.afterMerge(merged);

    await ports.saveCursor({
      items: cloudItems.reduce<string | null>((t, i) => later(t, i.serverUpdatedAt), cursor?.items ?? null),
      entries: cloudEntries.reduce<string | null>((t, e) => later(t, e.serverUpdatedAt), cursor?.entries ?? null),
    });

    return 'synced';
  } catch (error) {
    // Offline, signed out, or a server error. Local state, queue and cursor
    // are untouched; the next trigger retries.
    return ports.classifyError(error);
  }
}
