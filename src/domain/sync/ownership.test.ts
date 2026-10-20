/**
 * Tests for the device-ownership rule (F3: items leaking between accounts).
 *
 * Run with:  npm test
 * Same approach as runSync.test.ts: ownership.ts and runSync.ts are pure and
 * take their I/O as ports, so an in-memory phone and backend stand in here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideOnSignIn, applySignIn, type OwnershipPorts } from './ownership.ts';
import { classifySyncError } from './classify.ts';
import { runSync, type SyncPorts, type QueueSnapshot } from './runSync.ts';
import type { SinceItem } from '../../types/index.ts';

function item(id: string): SinceItem {
  return {
    id,
    name: id,
    category: 'Other',
    lastDoneDate: '2026-08-01',
    history: [],
    repeatValue: null,
    repeatUnit: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

const ids = (items: SinceItem[]) => items.map((i) => i.id).sort();

/**
 * One phone and a backend holding a list per account. Wires both the
 * ownership ports and the sync ports to the same state, the way engine.ts
 * does for real.
 */
function phone(opts: { owner: string | null; local: SinceItem[]; signedIn: string }) {
  const state = {
    owner: opts.owner,
    signedIn: opts.signedIn,
    local: [...opts.local],
    queue: { upserts: [], deletes: [] } as QueueSnapshot,
    reminders: opts.local.length,
    cloud: new Map<string, SinceItem[]>(),
    enqueued: [] as string[],
    pushed: [] as Array<{ account: string; ids: string[] }>,
  };
  const cloudFor = (a: string) => state.cloud.get(a) ?? [];

  const ownership: OwnershipPorts = {
    loadOwner: async () => state.owner,
    saveOwner: async (id) => { state.owner = id; },
    loadItemIds: async () => state.local.map((i) => i.id),
    enqueueUpsert: async (id) => {
      state.enqueued.push(id);
      if (!state.queue.upserts.includes(id)) state.queue.upserts.push(id);
    },
    clearLocalData: async () => {
      state.local = [];
      state.queue = { upserts: [], deletes: [] };
      state.reminders = 0;
    },
  };

  const sync: SyncPorts = {
    isConfigured: () => true,
    isAuthenticated: async () => true,
    isOwnedBySignedInUser: async () => state.owner === state.signedIn,
    loadItems: async () => [...state.local],
    saveItems: async (items) => { state.local = [...items]; },
    loadQueue: async () => ({
      upserts: [...state.queue.upserts],
      deletes: [...state.queue.deletes],
    }),
    removeFromQueue: async (ops) => {
      state.queue = {
        upserts: state.queue.upserts.filter((id) => !ops.upserts.includes(id)),
        deletes: state.queue.deletes.filter((id) => !ops.deletes.includes(id)),
      };
    },
    cloudUpsertMany: async (items) => {
      state.pushed.push({ account: state.signedIn, ids: items.map((i) => i.id) });
      const rest = cloudFor(state.signedIn).filter((c) => !items.some((i) => i.id === c.id));
      state.cloud.set(state.signedIn, [...rest, ...items]);
    },
    cloudDeleteMany: async () => {},
    cloudLoadItems: async () => [...cloudFor(state.signedIn)],
    cloudLoadTombstones: async () => [],
    afterMerge: async (items) => { state.reminders = items.length; },
    classifyError: classifySyncError,
  };

  return { state, ownership, sync };
}

describe('decideOnSignIn', () => {
  test("adopts when no owner is stored", () => {
    assert.equal(decideOnSignIn(null, 'user-a'), 'adopt');
  });

  test('resumes when the stored owner is the signed-in account', () => {
    assert.equal(decideOnSignIn('user-a', 'user-a'), 'resume');
  });

  test('replaces when the stored owner is a different account', () => {
    assert.equal(decideOnSignIn('user-a', 'user-b'), 'replace');
  });
});

describe('applySignIn', () => {
  test('adopt: records the owner and uploads every local item', async () => {
    const p = phone({ owner: null, local: [item('1'), item('2')], signedIn: 'user-a' });

    assert.equal(await applySignIn(p.ownership, 'user-a'), 'adopt');
    assert.equal(p.state.owner, 'user-a');
    assert.deepEqual(p.state.queue.upserts.sort(), ['1', '2']);

    assert.equal(await runSync(p.sync), 'synced');
    assert.deepEqual(ids(p.state.cloud.get('user-a') ?? []), ['1', '2']);
  });

  test('resume: leaves local state alone and syncs', async () => {
    const p = phone({ owner: 'user-a', local: [item('1')], signedIn: 'user-a' });

    assert.equal(await applySignIn(p.ownership, 'user-a'), 'resume');
    assert.deepEqual(p.state.enqueued, []);
    assert.deepEqual(ids(p.state.local), ['1']);
    assert.equal(await runSync(p.sync), 'synced');
  });

  test("replace: never enqueues or pushes the previous account's items", async () => {
    // A's list is on the phone; B signs in. B already has an item in the
    // cloud, and one of A's ids collides with it.
    const p = phone({
      owner: 'user-a',
      local: [item('a-1'), item('shared-id')],
      signedIn: 'user-b',
    });
    p.state.queue.upserts = ['a-1'];
    p.state.cloud.set('user-b', [{ ...item('shared-id'), name: "B's item" }]);

    // A sync that fires before the rule runs (e.g. app start) must not
    // upload A's items into B's account.
    assert.equal(await runSync(p.sync), 'skipped');
    assert.deepEqual(p.state.pushed, []);

    assert.equal(await applySignIn(p.ownership, 'user-b'), 'replace');
    assert.deepEqual(p.state.enqueued, [], "A's items must never be enqueued");
    assert.equal(p.state.owner, 'user-b');
    assert.equal(p.state.local.length, 0);
    assert.deepEqual(p.state.queue, { upserts: [], deletes: [] });
    assert.equal(p.state.reminders, 0, "A's reminders are cancelled");

    // The sync after the rule only pulls B's list.
    assert.equal(await runSync(p.sync), 'synced');
    assert.deepEqual(p.state.pushed, [], "nothing of A's is ever pushed");
    assert.deepEqual(ids(p.state.local), ['shared-id']);
    assert.equal(p.state.local[0].name, "B's item");
  });

  test('replace: asks first, and declining changes nothing on the phone', async () => {
    const p = phone({ owner: 'user-a', local: [item('a-1')], signedIn: 'user-b' });
    p.state.queue.upserts = ['a-1'];
    let asked = 0;

    const result = await applySignIn(p.ownership, 'user-b', async () => { asked++; return false; });

    assert.equal(result, 'cancelled');
    assert.equal(asked, 1);
    assert.equal(p.state.owner, 'user-a', 'the list still belongs to A');
    assert.deepEqual(ids(p.state.local), ['a-1']);
    assert.deepEqual(p.state.queue.upserts, ['a-1']);
    assert.equal(p.state.reminders, 1, "A's reminders are kept");
    // Signed in as B with A's list still here, sync touches nothing.
    assert.equal(await runSync(p.sync), 'skipped');
    assert.deepEqual(p.state.pushed, []);
  });

  test('replace: agreeing clears the list and pulls the new account', async () => {
    const p = phone({ owner: 'user-a', local: [item('a-1')], signedIn: 'user-b' });
    p.state.cloud.set('user-b', [item('b-1')]);

    assert.equal(await applySignIn(p.ownership, 'user-b', async () => true), 'replace');
    assert.equal(p.state.owner, 'user-b');
    assert.equal(await runSync(p.sync), 'synced');
    assert.deepEqual(ids(p.state.local), ['b-1']);
    assert.deepEqual(p.state.pushed, []);
  });

  test("replace: doesn't ask when the other account's list is already empty", async () => {
    const p = phone({ owner: 'user-a', local: [], signedIn: 'user-b' });
    let asked = 0;

    assert.equal(await applySignIn(p.ownership, 'user-b', async () => { asked++; return false; }), 'replace');
    assert.equal(asked, 0);
    assert.equal(p.state.owner, 'user-b');
  });

  test('adopt and resume never ask', async () => {
    let asked = 0;
    const ask = async () => { asked++; return false; };
    const fresh = phone({ owner: null, local: [item('1')], signedIn: 'user-a' });
    assert.equal(await applySignIn(fresh.ownership, 'user-a', ask), 'adopt');
    const same = phone({ owner: 'user-a', local: [item('1')], signedIn: 'user-a' });
    assert.equal(await applySignIn(same.ownership, 'user-a', ask), 'resume');
    assert.equal(asked, 0);
  });

  test('replace: interrupted before the owner is saved, it replaces again', async () => {
    const p = phone({ owner: 'user-a', local: [item('a-1')], signedIn: 'user-b' });
    p.ownership.saveOwner = async () => { throw new Error('interrupted'); };

    await assert.rejects(applySignIn(p.ownership, 'user-b'));
    assert.equal(p.state.owner, 'user-a');
    assert.equal(decideOnSignIn(p.state.owner, 'user-b'), 'replace');
  });
});
