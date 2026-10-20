/**
 * Tests for syncing history entries one by one (sync plan, PR 3): two phones
 * on one account, against an in-memory cloud that behaves like the
 * completion_events table (supabase/migrations/003_history_table.sql):
 * insert-only rows never overwrite, overwrites never touch deleted_at, deletes
 * are soft, change times come from the server, and an entry needs its item.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSync,
  mergeItems,
  entryPushFor,
  pendingFrom,
  serverTimeMs,
  type SyncPorts,
  type CloudItem,
  type CloudEntry,
  type EntryPush,
  type SyncCursor,
} from './runSync.ts';
import {
  EMPTY_QUEUE,
  readQueue,
  withUpsert,
  withDelete,
  withEntryUpsert,
  withEntryDelete,
  withoutPushed,
  type SyncQueue,
} from './queueOps.ts';
import { classifySyncError } from './classify.ts';
import { addEntry, updateEntry, deleteEntry } from '../items/history.ts';
import type { SinceItem } from '../../types/index.ts';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const TODAY = '2026-10-20';
const NOW = '2026-10-20T09:00:00.000Z';

function item(id: string, dates: string[] = ['2026-10-01'], name = id): SinceItem {
  const history = dates.map((date, i) => ({ id: `${id}-e${i}`, date }));
  return {
    id,
    name,
    category: 'Household',
    lastDoneDate: [...dates].sort().reverse()[0],
    history: [...history].sort((a, b) => (a.date < b.date ? 1 : -1)),
    repeatValue: null,
    repeatUnit: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

// ─── The cloud ───────────────────────────────────────────────────────────────

function fakeCloud() {
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 9, 20, 0, 0, ++clock)).toISOString();
  const key = (itemId: string, id: string) => `${itemId}/${id}`;
  const state = {
    items: new Map<string, CloudItem>(),
    entries: new Map<string, CloudEntry>(),
    tombstones: [] as string[],
    calls: [] as string[],
  };

  const fkCheck = (itemId: string) => {
    if (!state.items.has(itemId)) throw Object.assign(new Error('foreign key'), { code: '23503' });
  };

  return {
    state,
    upsertItems(items: SinceItem[]) {
      for (const i of items) state.items.set(i.id, { ...clone(i), serverUpdatedAt: tick() });
    },
    pushEntries(push: EntryPush) {
      for (const e of push.insertOnly) {
        fkCheck(e.itemId);
        if (state.entries.has(key(e.itemId, e.id))) continue;
        state.entries.set(key(e.itemId, e.id), {
          itemId: e.itemId, id: e.id, date: e.date, note: e.note,
          createdAt: e.createdAt ?? null, deletedAt: null, serverUpdatedAt: tick(),
        });
      }
      for (const e of push.overwrite) {
        fkCheck(e.itemId);
        const existing = state.entries.get(key(e.itemId, e.id));
        state.entries.set(key(e.itemId, e.id), {
          itemId: e.itemId, id: e.id, date: e.date, note: e.note,
          createdAt: existing?.createdAt ?? e.createdAt ?? null,
          deletedAt: existing?.deletedAt ?? null,
          serverUpdatedAt: tick(),
        });
      }
      for (const r of push.softDelete) {
        const existing = state.entries.get(key(r.itemId, r.entryId));
        if (existing && !existing.deletedAt) {
          state.entries.set(key(r.itemId, r.entryId), { ...existing, deletedAt: NOW, serverUpdatedAt: tick() });
        }
      }
    },
    deleteItems(ids: string[]) {
      for (const id of ids) {
        state.items.delete(id);
        for (const [k, e] of state.entries) if (e.itemId === id) state.entries.delete(k);
        state.tombstones.push(id);
      }
    },
    loadItems(since: string | null) {
      state.calls.push(`items since ${since}`);
      return [...state.items.values()].filter((i) => !since || i.serverUpdatedAt! > since).map(clone);
    },
    loadEntries(since: string | null, itemIds?: string[]) {
      return [...state.entries.values()]
        .filter((e) => !since || e.serverUpdatedAt > since)
        .filter((e) => !itemIds || itemIds.includes(e.itemId))
        .map(clone);
    },
  };
}

type Cloud = ReturnType<typeof fakeCloud>;

// ─── A phone ─────────────────────────────────────────────────────────────────

function phone(cloud: Cloud, local: SinceItem[] = [], queue: SyncQueue = { ...EMPTY_QUEUE }) {
  const state = {
    local: clone(local),
    queue: clone(queue),
    cursor: null as SyncCursor | null,
    rescheduled: 0,
  };

  const ports: SyncPorts = {
    isConfigured: () => true,
    isAuthenticated: async () => true,
    isOwnedBySignedInUser: async () => true,
    loadItems: async () => clone(state.local),
    saveItems: async (items) => { state.local = clone(items); },
    loadQueue: async () => clone(state.queue),
    removeFromQueue: async (ops) => { state.queue = withoutPushed(state.queue, ops); },
    cloudUpsertMany: async (items) => cloud.upsertItems(items),
    cloudDeleteMany: async (ids) => cloud.deleteItems(ids),
    cloudPushEntries: async (push) => cloud.pushEntries(push),
    cloudLoadItems: async (since) => cloud.loadItems(since),
    cloudLoadEntries: async (since, itemIds) => cloud.loadEntries(since, itemIds),
    cloudLoadTombstones: async () => [...cloud.state.tombstones],
    loadCursor: async () => state.cursor,
    saveCursor: async (c) => { state.cursor = c; },
    afterMerge: async () => { state.rescheduled++; },
    classifyError: classifySyncError,
  };

  const get = (id: string) => state.local.find((i) => i.id === id)!;
  const put = (updated: SinceItem) => {
    state.local = state.local.map((i) => (i.id === updated.id ? updated : i));
  };

  // Each mirrors what items/service.ts does: change locally, then queue.
  return {
    state,
    get,
    sync: () => runSync(ports),
    create(it: SinceItem) {
      state.local.push(clone(it));
      state.queue = withUpsert(state.queue, it.id);
    },
    rename(id: string, name: string) {
      put({ ...get(id), name });
      state.queue = withUpsert(state.queue, id);
    },
    markDone(id: string, entryId: string, date: string) {
      put(addEntry(get(id), { id: entryId, date }, TODAY, NOW));
      state.queue = withEntryUpsert(state.queue, { itemId: id, entryId });
    },
    note(id: string, entryId: string, note: string) {
      put(updateEntry(get(id), entryId, { note }, TODAY, NOW));
      state.queue = withEntryUpsert(state.queue, { itemId: id, entryId });
    },
    deleteEntry(id: string, entryId: string) {
      put(deleteEntry(get(id), entryId, NOW));
      state.queue = withEntryDelete(state.queue, { itemId: id, entryId });
    },
    deleteItem(id: string) {
      state.local = state.local.filter((i) => i.id !== id);
      state.queue = withDelete(state.queue, id);
    },
  };
}

const entryIds = (it: SinceItem) => it.history.map((e) => e.id).sort();

/** Phones A and B, both holding `gutters` (already in the cloud). */
async function twoPhones() {
  const cloud = fakeCloud();
  const a = phone(cloud);
  a.create(item('gutters', ['2026-10-01']));
  assert.equal(await a.sync(), 'synced');
  const b = phone(cloud);
  assert.equal(await b.sync(), 'synced');
  return { cloud, a, b };
}

// ─── Two phones ──────────────────────────────────────────────────────────────

describe('two phones, one account', () => {
  test('both phones mark the same item done offline: both entries survive on both', async () => {
    const { a, b } = await twoPhones();
    a.markDone('gutters', 'from-a', '2026-10-10');
    b.markDone('gutters', 'from-b', '2026-10-12');

    await a.sync();
    await b.sync();
    await a.sync();

    for (const p of [a, b]) {
      assert.deepEqual(entryIds(p.get('gutters')), ['from-a', 'from-b', 'gutters-e0']);
      assert.equal(p.get('gutters').lastDoneDate, '2026-10-12');
    }
  });

  test('an entry deleted on one phone goes from the other, and is never sent back', async () => {
    const { a, b } = await twoPhones();
    a.markDone('gutters', 'oops', '2026-10-10');
    await a.sync();
    await b.sync();
    assert.ok(entryIds(b.get('gutters')).includes('oops'));

    a.deleteEntry('gutters', 'oops');
    await a.sync();
    // B renames the item meanwhile, so it pushes the whole item, history and all
    b.rename('gutters', 'Clean gutters');
    await b.sync();
    await a.sync();

    for (const p of [a, b]) assert.deepEqual(entryIds(p.get('gutters')), ['gutters-e0']);
  });

  test("a note edited on one phone reaches the other; this phone's unsent edit isn't overwritten", async () => {
    const { a, b } = await twoPhones();
    a.note('gutters', 'gutters-e0', 'From A');
    b.note('gutters', 'gutters-e0', 'From B');

    await a.sync();
    await b.sync(); // B's edit is pending until it pushes, then it's the last word
    assert.equal(b.get('gutters').history[0].note, 'From B');
    await a.sync();
    assert.equal(a.get('gutters').history[0].note, 'From B');
  });

  test("editing an entry another phone deleted doesn't bring it back", async () => {
    const { a, b } = await twoPhones();
    a.markDone('gutters', 'e', '2026-10-10');
    await a.sync();
    await b.sync();

    a.deleteEntry('gutters', 'e');
    b.note('gutters', 'e', 'Too late');
    await a.sync();
    await b.sync();
    await a.sync();

    for (const p of [a, b]) assert.deepEqual(entryIds(p.get('gutters')), ['gutters-e0']);
  });

  test("marking done doesn't send this phone's old copy of the name over a rename", async () => {
    const { a, b } = await twoPhones();
    a.rename('gutters', 'Clean the gutters');
    await a.sync();

    b.markDone('gutters', 'from-b', '2026-10-12');
    await b.sync();
    await a.sync();

    for (const p of [a, b]) {
      assert.equal(p.get('gutters').name, 'Clean the gutters');
      assert.ok(entryIds(p.get('gutters')).includes('from-b'));
    }
  });

  test('an item never loses its last entry, even if each phone deleted a different one', async () => {
    const { a, b } = await twoPhones();
    a.markDone('gutters', 'second', '2026-10-10');
    await a.sync();
    await b.sync();

    a.deleteEntry('gutters', 'gutters-e0');
    b.deleteEntry('gutters', 'second');
    await a.sync();
    await b.sync();
    await a.sync();

    for (const p of [a, b]) assert.equal(p.get('gutters').history.length, 1);
  });

  test('a new item from the other phone arrives with every entry, old ones included', async () => {
    const { a, b } = await twoPhones();
    a.create(item('dentist', ['2026-04-01', '2026-10-01']));
    await a.sync();
    a.markDone('dentist', 'later', '2026-10-15');
    await a.sync();

    await b.sync();
    assert.deepEqual(entryIds(b.get('dentist')), ['dentist-e0', 'dentist-e1', 'later']);
  });

  test('a deleted item goes from the other phone, entries and all', async () => {
    const { cloud, a, b } = await twoPhones();
    a.deleteItem('gutters');
    await a.sync();
    await b.sync();
    assert.equal(b.state.local.length, 0);
    assert.equal([...cloud.state.entries.values()].filter((e) => e.itemId === 'gutters').length, 0);
  });
});

// ─── Upgrading and pulling ───────────────────────────────────────────────────

describe('first sync after upgrading, and the pull cursor', () => {
  test("entries made before entries were synced one by one reach the cloud, and the other phone", async () => {
    // The cloud has the item, as earlier builds pushed it, but no entry rows
    const cloud = fakeCloud();
    const old = item('bins', ['2026-09-01', '2026-10-01']);
    cloud.upsertItems([old]);
    const a = phone(cloud, [old]);

    await a.sync();
    assert.deepEqual(
      [...cloud.state.entries.values()].map((e) => e.id).sort(),
      ['bins-e0', 'bins-e1'],
    );
  });

  test('later pulls ask only for what changed since the last one', async () => {
    const { cloud, a } = await twoPhones();
    const before = cloud.state.calls.length;
    await a.sync();
    const since = cloud.state.calls.slice(before).find((c) => c.startsWith('items since'));
    assert.notEqual(since, 'items since null');
    assert.ok(a.state.cursor?.items);
  });

  test('reminders are rescheduled after every successful sync', async () => {
    const { a } = await twoPhones();
    const n = a.state.rescheduled;
    await a.sync();
    assert.equal(a.state.rescheduled, n + 1);
  });

  test("an entry for an item the cloud doesn't have yet (queue lost) sends the item, then the entry", async () => {
    const cloud = fakeCloud();
    const a = phone(cloud, [item('plants')]);
    a.markDone('plants', 'today', TODAY);

    assert.equal(await a.sync(), 'synced');
    assert.ok(cloud.state.items.has('plants'));
    assert.ok([...cloud.state.entries.values()].some((e) => e.id === 'today'));
  });

  test('a failed push leaves the queue and cursor alone', async () => {
    const { cloud, a } = await twoPhones();
    const cursor = clone(a.state.cursor);
    a.markDone('gutters', 'x', '2026-10-15');
    cloud.pushEntries = () => { throw Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError' }); };

    assert.equal(await a.sync(), 'offline');
    assert.equal(a.state.queue.entryUpserts.length, 1);
    assert.deepEqual(a.state.cursor, cursor);
  });
});

// ─── Pieces ──────────────────────────────────────────────────────────────────

describe('what gets pushed', () => {
  test('a pushed item sends every entry insert-only; edited entries overwrite; deletes are soft', () => {
    const it = item('a', ['2026-10-01', '2026-10-05']);
    const push = entryPushFor(
      {
        upserts: ['a'],
        deletes: [],
        entryUpserts: [{ itemId: 'a', entryId: 'a-e1' }],
        entryDeletes: [{ itemId: 'a', entryId: 'gone' }],
      },
      [it],
    );
    assert.deepEqual(push.insertOnly.map((e) => e.id).sort(), ['a-e0', 'a-e1']);
    assert.deepEqual(push.overwrite.map((e) => e.id), ['a-e1']);
    assert.deepEqual(push.softDelete, [{ itemId: 'a', entryId: 'gone' }]);
  });

  test("an entry's changes aren't sent when its item is being deleted", () => {
    const push = entryPushFor(
      { upserts: [], deletes: ['a'], entryUpserts: [], entryDeletes: [{ itemId: 'a', entryId: 'x' }] },
      [],
    );
    assert.deepEqual(push.softDelete, []);
  });

  test('an older queue with no entry lists still pushes its items', () => {
    const push = entryPushFor({ upserts: ['a'], deletes: [] }, [item('a')]);
    assert.equal(push.insertOnly.length, 1);
  });
});

describe('the queue', () => {
  test('a queue saved before entries were queued reads with empty entry lists', () => {
    assert.deepEqual(readQueue({ upserts: ['a'], deletes: ['b'] }), {
      upserts: ['a'], deletes: ['b'], entryUpserts: [], entryDeletes: [],
    });
    assert.deepEqual(readQueue('nonsense'), EMPTY_QUEUE);
  });

  test("deleting an entry supersedes its unsent edit, and deleting the item drops both", () => {
    let q = withEntryUpsert(EMPTY_QUEUE, { itemId: 'a', entryId: 'e' });
    q = withEntryDelete(q, { itemId: 'a', entryId: 'e' });
    assert.deepEqual(q.entryUpserts, []);
    assert.deepEqual(q.entryDeletes, [{ itemId: 'a', entryId: 'e' }]);
    q = withDelete(withEntryUpsert(q, { itemId: 'a', entryId: 'f' }), 'a');
    assert.deepEqual([q.entryUpserts, q.entryDeletes, q.deletes], [[], [], ['a']]);
  });

  test('only what was pushed is retired; a change made mid-push stays', () => {
    const pushed = withEntryUpsert(EMPTY_QUEUE, { itemId: 'a', entryId: 'e1' });
    const now = withEntryUpsert(pushed, { itemId: 'a', entryId: 'e2' });
    assert.deepEqual(withoutPushed(now, pushed).entryUpserts, [{ itemId: 'a', entryId: 'e2' }]);
  });
});

describe('mergeItems with entries', () => {
  test("an entry deleted here and not yet sent isn't brought back by the cloud", () => {
    const local = item('a', ['2026-10-01', '2026-10-05']);
    local.history = local.history.filter((e) => e.id !== 'a-e1');
    const cloudEntry: CloudEntry = {
      itemId: 'a', id: 'a-e1', date: '2026-10-05', note: null, createdAt: null, deletedAt: null, serverUpdatedAt: NOW,
    };
    const pending = pendingFrom({ upserts: [], deletes: [], entryDeletes: [{ itemId: 'a', entryId: 'a-e1' }] });
    const [merged] = mergeItems([local], [], new Set(), [cloudEntry], pending);
    assert.deepEqual(entryIds(merged), ['a-e0']);
  });
});

describe('server change times', () => {
  // Postgres gives microseconds; some JavaScript engines only read three
  // decimal places, and a time they can't read would leave the cursor stuck.
  test('times with microseconds, a space or a short offset are read to the millisecond', () => {
    assert.equal(serverTimeMs('2026-10-20T02:44:12.123456+00:00'), Date.UTC(2026, 9, 20, 2, 44, 12, 123));
    assert.equal(serverTimeMs('2026-10-20 02:44:12.5+00'), Date.UTC(2026, 9, 20, 2, 44, 12, 500));
    assert.equal(serverTimeMs('2026-10-20T02:44:12Z'), Date.UTC(2026, 9, 20, 2, 44, 12));
    assert.ok(Number.isNaN(serverTimeMs('not a time')));
  });

  test('the cursor moves to the latest time pulled, whatever its precision', async () => {
    const cloud = fakeCloud();
    const a = phone(cloud);
    a.create(item('gutters'));
    // A Postgres-style time, later than anything the fake clock produces
    const late = '2026-10-21T00:00:00.654321+00:00';
    const loadItems = cloud.loadItems;
    cloud.loadItems = (since) => loadItems(since).map((i) => ({ ...i, serverUpdatedAt: late }));
    await a.sync();
    assert.equal(a.state.cursor?.items, late);
  });
});
