/**
 * Changes the server refuses for good (size limits, migration 006): parked,
 * not retried, never holding up the rest of the queue, and tried again once
 * the item is edited. Also: queues saved by earlier builds still load.
 *
 * Run with:  npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncError } from './classify.ts';
import { runSync, parkBeforePush, type SyncPorts, type QueueSnapshot, type EntryPush, type Parked } from './runSync.ts';
import {
  readQueue,
  withUpsert,
  withDelete,
  withEntryUpsert,
  withoutPushed,
  withoutItems,
  withParked,
  activeParked,
  type SyncQueue,
} from './queueOps.ts';
import { refusalCode, itemProblem, noteProblem, parkedMessage, LIMITS, REFUSAL } from './limits.ts';
import type { SinceItem } from '../../types/index.ts';

function item(id: string, over: Partial<SinceItem> = {}): SinceItem {
  return {
    id,
    name: id,
    category: 'Other',
    lastDoneDate: '2026-08-01',
    history: [{ id: `${id}-e1`, date: '2026-08-01' }],
    repeatValue: null,
    repeatUnit: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/** Shaped like a PostgrestError for a refused write. */
const refusal = (code: string, hint: string) =>
  Object.assign(new Error('refused'), { code, hint, details: null });

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * In-memory device and backend. The server refuses, for good, whatever
 * `refuse` says; it otherwise accepts. The queue goes through the real
 * queue rules (queueOps.ts), as on the phone.
 */
function harness(refuse: { item?: (i: SinceItem) => string | null; entry?: (itemId: string) => string | null } = {}) {
  const state = {
    local: [] as SinceItem[],
    queue: readQueue({}) as SyncQueue,
    cloud: new Map<string, SinceItem>(),
    entriesSent: [] as string[],
    itemCalls: 0,
  };
  const ports: SyncPorts = {
    isConfigured: () => true,
    isAuthenticated: async () => true,
    isOwnedBySignedInUser: async () => true,
    loadItems: async () => clone(state.local),
    saveItems: async (items) => { state.local = clone(items); },
    loadQueue: async () => clone(state.queue),
    removeFromQueue: async (ops) => { state.queue = withoutPushed(state.queue, ops); },
    parkChanges: async (parked: Record<string, Parked>) => { state.queue = withParked(state.queue, parked); },
    cloudUpsertMany: async (items) => {
      state.itemCalls += 1;
      for (const i of items) {
        const code = refuse.item?.(i);
        if (code) throw refusal(code, 'since_test');
      }
      items.forEach((i) => state.cloud.set(i.id, clone(i)));
    },
    cloudDeleteMany: async (ids) => { ids.forEach((id) => state.cloud.delete(id)); },
    cloudPushEntries: async (push: EntryPush) => {
      const rows = [...push.insertOnly, ...push.overwrite];
      for (const r of rows) {
        const code = refuse.entry?.(r.itemId);
        if (code) throw refusal(code, 'since_test');
      }
      state.entriesSent.push(...rows.map((r) => r.id));
    },
    cloudLoadItems: async () => [],
    cloudLoadEntries: async () => [],
    cloudLoadTombstones: async () => [],
    loadCursor: async () => ({ items: null, entries: null }),
    saveCursor: async () => {},
    afterMerge: async () => {},
    classifyError: classifySyncError,
  };
  /** As items/service.ts does: save, then queue the item. */
  const save = (i: SinceItem) => {
    state.local = [...state.local.filter((x) => x.id !== i.id), clone(i)];
    state.queue = withUpsert(state.queue, i.id);
  };
  return { state, ports, save };
}

const longName = 'n'.repeat(LIMITS.name + 1);

describe('refusals: which errors are permanent', () => {
  test('SN001–SN007 are permanent, by code or by hint', () => {
    for (const code of Object.values(REFUSAL)) assert.equal(refusalCode({ code, hint: null }), code);
    assert.equal(refusalCode({ code: '', hint: 'since_note_too_long' }), 'SN005');
    assert.equal(refusalCode({ code: 'XX000', hint: 'since_too_many_items' }), 'SN007');
  });

  test('offline, signed out and other server errors are not', () => {
    assert.equal(refusalCode(Object.assign(new Error('Network request failed'), { name: 'TypeError' })), null);
    assert.equal(refusalCode({ code: 'PGRST301' }), null);
    assert.equal(refusalCode({ code: '23503' }), null);
    assert.equal(refusalCode({ code: 'P0001', hint: 'since_join_busy' }), null);
    assert.equal(refusalCode(null), null);
    assert.equal(refusalCode('SN001'), null);
  });

  test('each refusal says what to change, calmly', () => {
    assert.equal(parkedMessage('SN001'), 'This name is too long to sync. Shorten it and it will go through.');
    for (const code of [...Object.values(REFUSAL), 'SN999']) {
      const copy = parkedMessage(code);
      assert.ok(copy.length > 0);
      assert.ok(!copy.includes('!'), copy);
    }
  });
});

describe('limits checked on the phone, as the server counts them', () => {
  test('at the limit is fine; one over is refused', () => {
    assert.equal(itemProblem(item('a', { name: 'n'.repeat(LIMITS.name) })), null);
    assert.equal(itemProblem(item('a', { name: longName })), 'SN001');
    assert.equal(itemProblem(item('a', { category: 'c'.repeat(LIMITS.category + 1) })), 'SN002');
    assert.equal(noteProblem('x'.repeat(LIMITS.note)), null);
    assert.equal(noteProblem('x'.repeat(LIMITS.note + 1)), 'SN005');
    assert.equal(noteProblem(undefined), null);
  });

  test('characters, not UTF-16 units: 500 emoji are a 500-character name', () => {
    assert.equal(itemProblem(item('a', { name: '🙂'.repeat(LIMITS.name) })), null);
  });

  test('an item push also checks every note, which go with it', () => {
    const long = item('a', { history: [{ id: 'e', date: '2026-08-01', note: 'x'.repeat(LIMITS.note + 1) }] });
    assert.equal(itemProblem(long), 'SN005');
  });

  test('history over 20 000 entries is refused', () => {
    const history = Array.from({ length: LIMITS.historyEntries + 1 }, (_, n) => ({ id: `e${n}`, date: '2026-08-01' }));
    assert.equal(itemProblem(item('a', { history })), 'SN003');
  });
});

describe('the queue keeps parked changes, and older queues still load', () => {
  test('a queue saved before parking existed loads as it was', () => {
    const q = readQueue({ upserts: ['a'], deletes: ['b'] });
    assert.deepEqual(q, { upserts: ['a'], deletes: ['b'], entryUpserts: [], entryDeletes: [] });
    const withEntries = readQueue({
      upserts: [], deletes: [], entryUpserts: [{ itemId: 'a', entryId: 'e' }], entryDeletes: [],
      deleteMeta: { b: { ownerId: 'sam' } },
    });
    assert.deepEqual(withEntries.entryUpserts, [{ itemId: 'a', entryId: 'e' }]);
    assert.equal(withEntries.parked, undefined);
  });

  test('parked entries load; unreadable ones are dropped, never thrown', () => {
    const q = readQueue({
      upserts: ['a'], deletes: [], entryUpserts: [], entryDeletes: [],
      parked: { a: { code: 'SN001', updatedAt: 't1' }, b: { code: 7 }, c: null, d: 'SN001' },
    });
    assert.deepEqual(q.parked, { a: { code: 'SN001', updatedAt: 't1' } });
    assert.equal(readQueue({ upserts: [], parked: [1, 2] }).parked, undefined);
    assert.equal(readQueue({ upserts: [], parked: 'x' }).parked, undefined);
  });

  test('a parked item keeps its place in the queue; queue changes keep the parking', () => {
    let q: SyncQueue = withParked(readQueue({ upserts: ['a'] }), { a: { code: 'SN001', updatedAt: 't1' } });
    q = withUpsert(q, 'b');
    q = withEntryUpsert(q, { itemId: 'b', entryId: 'e' });
    q = withoutPushed(q, { upserts: ['b'], deletes: [], entryUpserts: [{ itemId: 'b', entryId: 'e' }], entryDeletes: [] });
    assert.deepEqual(q.upserts, ['a']);
    assert.deepEqual(q.parked, { a: { code: 'SN001', updatedAt: 't1' } });
  });

  test('a parking applies only while the item is unchanged', () => {
    const q = withParked(readQueue({ upserts: ['a'] }), { a: { code: 'SN001', updatedAt: 't1' } });
    assert.ok(activeParked(q, { id: 'a', updatedAt: 't1' }));
    assert.equal(activeParked(q, { id: 'a', updatedAt: 't2' }), null);
  });

  test('deleting a parked item drops its parking; a delete also frees items parked by the item limit', () => {
    let q = withParked(readQueue({ upserts: ['a', 'b', 'c'] }), {
      a: { code: 'SN001', updatedAt: 't' },
      b: { code: 'SN007', updatedAt: 't' },
      c: { code: 'SN005', updatedAt: 't' },
    });
    q = withDelete(q, 'a');
    assert.deepEqual(q.parked, { c: { code: 'SN005', updatedAt: 't' } });
    assert.deepEqual(withoutItems(q, ['c']).parked, undefined);
  });
});

describe('runSync: a refused change is parked, and the rest still syncs', () => {
  test('a name over the limit is never sent; other items go through', async () => {
    const h = harness();
    h.save(item('long', { name: longName }));
    h.save(item('ok'));

    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual([...h.state.cloud.keys()], ['ok']);
    assert.deepEqual(h.state.queue.upserts, ['long'], 'kept for later, not dropped');
    assert.equal(h.state.queue.parked?.long?.code, 'SN001');
    assert.ok(h.state.local.some((i) => i.id === 'long' && i.name === longName), 'still on the phone, unchanged');
  });

  test('a refusal only the server knows about parks that item; the others still sync', async () => {
    const h = harness({ item: (i) => (i.id === 'b' ? 'SN007' : null) });
    h.save(item('a'));
    h.save(item('b'));
    h.save(item('c'));

    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual([...h.state.cloud.keys()].sort(), ['a', 'c']);
    assert.deepEqual(h.state.queue.upserts, ['b']);
    assert.equal(h.state.queue.parked?.b?.code, 'SN007');
    assert.ok(!h.state.entriesSent.includes('b-e1'), "its entries wait with it");
  });

  test('a parked change is not sent again on the next sync', async () => {
    const h = harness({ item: (i) => (i.id === 'b' ? 'SN007' : null) });
    h.save(item('b'));
    await runSync(h.ports);
    const calls = h.state.itemCalls;

    assert.equal(await runSync(h.ports), 'synced');
    assert.equal(h.state.itemCalls, calls, 'no retry');
    assert.equal(h.state.queue.parked?.b?.code, 'SN007');
  });

  test('editing the item tries again, and a fixed change goes through', async () => {
    const h = harness();
    h.save(item('long', { name: longName }));
    await runSync(h.ports);
    assert.deepEqual(h.state.queue.upserts, ['long']);

    h.save(item('long', { name: 'Shorter', updatedAt: '2026-08-02T00:00:00.000Z' }));
    assert.equal(await runSync(h.ports), 'synced');
    assert.equal(h.state.cloud.get('long')?.name, 'Shorter');
    assert.deepEqual(h.state.queue.upserts, []);
    assert.equal(h.state.queue.parked, undefined);
  });

  test('an edit that is still too long is parked again, with the new version', async () => {
    const h = harness();
    h.save(item('long', { name: longName }));
    await runSync(h.ports);
    h.save(item('long', { name: longName + 'x', updatedAt: '2026-08-02T00:00:00.000Z' }));
    await runSync(h.ports);
    assert.deepEqual(h.state.queue.parked, { long: { code: 'SN001', updatedAt: '2026-08-02T00:00:00.000Z' } });
  });

  test('a long note on a new entry parks that item only', async () => {
    const h = harness();
    h.state.local = [
      item('a', { history: [{ id: 'note', date: '2026-08-02', note: 'x'.repeat(LIMITS.note + 1) }, { id: 'a-e1', date: '2026-08-01' }] }),
      item('b', { history: [{ id: 'done', date: '2026-08-02' }, { id: 'b-e1', date: '2026-08-01' }] }),
    ];
    h.state.queue = withEntryUpsert(withEntryUpsert(readQueue({}), { itemId: 'a', entryId: 'note' }), { itemId: 'b', entryId: 'done' });

    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual(h.state.entriesSent, ['done']);
    assert.deepEqual(h.state.queue.entryUpserts, [{ itemId: 'a', entryId: 'note' }]);
    assert.equal(h.state.queue.parked?.a?.code, 'SN005');
  });

  test('an entry refusal from the server parks that item; other entries still go', async () => {
    const h = harness({ entry: (itemId) => (itemId === 'a' ? 'SN006' : null) });
    h.state.local = [item('a'), item('b')];
    h.state.queue = withEntryUpsert(withEntryUpsert(readQueue({}), { itemId: 'a', entryId: 'a-e1' }), { itemId: 'b', entryId: 'b-e1' });

    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual(h.state.entriesSent, ['b-e1']);
    assert.equal(h.state.queue.parked?.a?.code, 'SN006');
  });

  test('an old long note already in the cloud does not stop marking done', async () => {
    const h = harness();
    h.state.local = [item('a', {
      history: [{ id: 'today', date: '2026-08-02' }, { id: 'old', date: '2026-08-01', note: 'x'.repeat(LIMITS.note + 1) }],
    })];
    h.state.queue = withEntryUpsert(readQueue({}), { itemId: 'a', entryId: 'today' });

    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual(h.state.entriesSent, ['today']);
    assert.equal(h.state.queue.parked, undefined);
  });

  test('deleting a parked item still deletes it in the cloud', async () => {
    const h = harness();
    h.save(item('long', { name: longName }));
    await runSync(h.ports);
    h.state.cloud.set('long', item('long'));
    h.state.local = [];
    h.state.queue = withDelete(h.state.queue, 'long');

    assert.equal(await runSync(h.ports), 'synced');
    assert.equal(h.state.cloud.has('long'), false);
    assert.equal(h.state.queue.parked, undefined);
  });

  test('a transient error still fails the sync and keeps everything queued, as before', async () => {
    const h = harness();
    h.ports.cloudUpsertMany = async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); };
    h.save(item('a'));
    assert.equal(await runSync(h.ports), 'error');
    assert.deepEqual(h.state.queue.upserts, ['a']);
    assert.equal(h.state.queue.parked, undefined);
  });

  test('a queue from an earlier build (no parked field) syncs as before', async () => {
    const h = harness();
    h.state.local = [item('a')];
    h.state.queue = readQueue({ upserts: ['a'], deletes: [] });
    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual([...h.state.cloud.keys()], ['a']);
    assert.deepEqual(h.state.queue.upserts, []);
  });
});

describe('parkBeforePush', () => {
  test('carries over a parking only while the item is unchanged', () => {
    const q: QueueSnapshot = { upserts: ['a'], deletes: [], parked: { a: { code: 'SN007', updatedAt: 't1' } } };
    assert.deepEqual(parkBeforePush(q, [item('a', { updatedAt: 't1' })]), { a: { code: 'SN007', updatedAt: 't1' } });
    assert.deepEqual(parkBeforePush(q, [item('a', { updatedAt: 't2' })]), {});
  });
});
