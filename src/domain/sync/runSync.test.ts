/**
 * Tests for the sync orchestration.
 *
 * Run with:  npm test
 * Uses Node's built-in test runner and native TypeScript stripping, so there
 * is no test framework, transform or mocking library to install. runSync is
 * pure and takes its I/O as ports, so nothing here touches AsyncStorage,
 * Supabase or React Native.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSync, mergeItems, type SyncPorts, type QueueSnapshot } from './runSync.ts';
import type { SinceItem } from '../../types/index.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function item(id: string, updatedAt: string): SinceItem {
  return {
    id,
    name: id,
    category: 'Other',
    lastDoneDate: '2026-08-01',
    history: [],
    repeatValue: null,
    repeatUnit: null,
    expiryDate: null,
    source: 'manual',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ids = (items: SinceItem[]) => items.map((i) => i.id).sort();

/**
 * In-memory harness standing in for device storage and the backend.
 * `pushLatencyMs` opens the window in which the race occurs.
 */
function harness(opts: { pushLatencyMs?: number } = {}) {
  const state = {
    local: [] as SinceItem[],
    queue: { upserts: [], deletes: [] } as QueueSnapshot,
    cloud: [] as SinceItem[],
    tombstones: [] as string[],
    rescheduledWith: null as SinceItem[] | null,
  };

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

  const ports: SyncPorts = {
    isConfigured: () => true,
    isAuthenticated: async () => true,
    loadItems: async () => clone(state.local),
    saveItems: async (items) => { state.local = clone(items); },
    loadQueue: async () => clone(state.queue),
    removeFromQueue: async (ops) => {
      const du = new Set(ops.upserts);
      const dd = new Set(ops.deletes);
      state.queue = {
        upserts: state.queue.upserts.filter((id) => !du.has(id)),
        deletes: state.queue.deletes.filter((id) => !dd.has(id)),
      };
    },
    cloudUpsertMany: async (items) => {
      await sleep(opts.pushLatencyMs ?? 0);
      for (const it of items) {
        state.cloud = state.cloud.filter((c) => c.id !== it.id);
        state.cloud.push(clone(it));
      }
    },
    cloudDeleteMany: async (idList) => {
      await sleep(opts.pushLatencyMs ?? 0);
      state.cloud = state.cloud.filter((c) => !idList.includes(c.id));
      state.tombstones.push(...idList);
    },
    cloudLoadItems: async () => clone(state.cloud),
    cloudLoadTombstones: async () => clone(state.tombstones),
    afterMerge: async (items) => { state.rescheduledWith = clone(items); },
  };

  /** Mirrors what items/service.ts does: write locally, then enqueue. */
  async function mutateLocally(it: SinceItem) {
    state.local = [...state.local.filter((i) => i.id !== it.id), clone(it)];
    if (!state.queue.upserts.includes(it.id)) state.queue.upserts.push(it.id);
  }

  async function deleteLocally(id: string) {
    state.local = state.local.filter((i) => i.id !== id);
    if (!state.queue.deletes.includes(id)) state.queue.deletes.push(id);
    state.queue.upserts = state.queue.upserts.filter((u) => u !== id);
  }

  return { state, ports, mutateLocally, deleteLocally };
}

// ─── The regression this suite exists for ────────────────────────────────────

describe('runSync — mutation during an in-flight sync', () => {
  test('an item added while a push is in flight is not lost', async () => {
    const h = harness({ pushLatencyMs: 50 });

    // Item A is created and a sync begins.
    await h.mutateLocally(item('A', '2026-08-22T10:00:00.000Z'));
    const syncing = runSync(h.ports);

    // Item B is created 10ms in, while A's push is still on the wire.
    await sleep(10);
    await h.mutateLocally(item('B', '2026-08-22T10:00:01.000Z'));

    const outcome = await syncing;
    assert.equal(outcome, 'synced');

    // B must survive locally. This is the exact case that previously erased
    // it from both local storage and the cloud.
    assert.deepEqual(ids(h.state.local), ['A', 'B'], 'B must remain in local storage');

    // A was pushed and retired from the queue; B is still queued for the
    // next run rather than silently dropped.
    assert.deepEqual(ids(h.state.cloud), ['A'], 'only A was pushed this run');
    assert.deepEqual(h.state.queue.upserts, ['B'], 'B must remain queued for retry');
  });

  test('the follow-up sync pushes the item that was queued mid-flight', async () => {
    const h = harness({ pushLatencyMs: 50 });

    await h.mutateLocally(item('A', '2026-08-22T10:00:00.000Z'));
    const syncing = runSync(h.ports);
    await sleep(10);
    await h.mutateLocally(item('B', '2026-08-22T10:00:01.000Z'));
    await syncing;

    // Second run drains the backlog — nothing is stranded.
    assert.equal(await runSync(h.ports), 'synced');
    assert.deepEqual(ids(h.state.cloud), ['A', 'B']);
    assert.deepEqual(ids(h.state.local), ['A', 'B']);
    assert.deepEqual(h.state.queue.upserts, []);
  });

  test('a delete issued mid-flight is not undone by the pull', async () => {
    const h = harness({ pushLatencyMs: 50 });

    // A already exists on both sides.
    await h.mutateLocally(item('A', '2026-08-22T10:00:00.000Z'));
    await runSync(h.ports);
    assert.deepEqual(ids(h.state.cloud), ['A']);

    // Start a sync, then delete A while it is in flight.
    await h.mutateLocally(item('C', '2026-08-22T10:00:02.000Z'));
    const syncing = runSync(h.ports);
    await sleep(10);
    await h.deleteLocally('A');
    await syncing;

    // The cloud still holds A (its delete has not been pushed), but the pull
    // must not resurrect it locally.
    assert.ok(!ids(h.state.local).includes('A'), 'locally deleted item must stay deleted');
    assert.deepEqual(h.state.queue.deletes, ['A'], 'delete stays queued for the next run');
  });
});

// ─── Failure handling ────────────────────────────────────────────────────────

describe('runSync — failure and gating', () => {
  test('a failed push leaves local state and the queue intact', async () => {
    const h = harness();
    await h.mutateLocally(item('A', '2026-08-22T10:00:00.000Z'));
    h.ports.cloudUpsertMany = async () => { throw new Error('offline'); };

    assert.equal(await runSync(h.ports), 'offline');
    assert.deepEqual(ids(h.state.local), ['A'], 'local data untouched');
    assert.deepEqual(h.state.queue.upserts, ['A'], 'queue intact for retry');
  });

  test('skips without touching anything when not configured', async () => {
    const h = harness();
    await h.mutateLocally(item('A', '2026-08-22T10:00:00.000Z'));
    h.ports.isConfigured = () => false;

    assert.equal(await runSync(h.ports), 'skipped');
    assert.deepEqual(h.state.cloud, []);
    assert.deepEqual(h.state.queue.upserts, ['A']);
  });

  test('skips when signed out', async () => {
    const h = harness();
    h.ports.isAuthenticated = async () => false;
    assert.equal(await runSync(h.ports), 'skipped');
  });
});

// ─── Conflict resolution ─────────────────────────────────────────────────────

describe('mergeItems — conflict rules', () => {
  const A_old = item('a', '2026-08-01T00:00:00.000Z');
  const A_new = item('a', '2026-08-02T00:00:00.000Z');

  test('the later updatedAt wins, whichever side it is on', () => {
    assert.deepEqual(mergeItems([A_new], [A_old], new Set()).map((i) => i.updatedAt), [A_new.updatedAt]);
    assert.deepEqual(mergeItems([A_old], [A_new], new Set()).map((i) => i.updatedAt), [A_new.updatedAt]);
  });

  test('equal timestamps do not flap', () => {
    assert.deepEqual(ids(mergeItems([A_old], [A_old], new Set())), ['a']);
  });

  test('a cloud-only item is adopted', () => {
    assert.deepEqual(ids(mergeItems([], [item('b', '2026-08-01T00:00:00.000Z')], new Set())), ['b']);
  });

  test('a local-only item is kept, never inferred as deleted', () => {
    assert.deepEqual(ids(mergeItems([item('c', '2026-08-01T00:00:00.000Z')], [], new Set())), ['c']);
  });

  test('a tombstone beats both a local edit and a cloud copy', () => {
    const t = new Set(['d']);
    assert.deepEqual(mergeItems([item('d', '2026-09-01T00:00:00.000Z')], [], t), []);
    assert.deepEqual(mergeItems([], [item('d', '2026-09-01T00:00:00.000Z')], t), []);
  });
});
