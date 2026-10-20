import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncNow } from '../engine';
import { loadQueue } from '../queue';
import { loadItems } from '../../items/storage';

/**
 * Before each sync the engine looks at the household again (sync plan, PR 6).
 * Signed in, with a stand-in cloud: these check what it does to the phone.
 */
const ME = 'user-me';
const SAM = 'user-sam';
const HOME = 'household-home';

const mockCloud = {
  household: null as null | { id: string; name: string; members: unknown[] },
  sharedKeys: new Set<string>(),
};

jest.mock('../../../lib/supabase', () => {
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-me' } } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'user-me' } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
  return { isCloudSyncConfigured: () => true, getSupabase: () => client, requireSupabase: () => client };
});
jest.mock('../../household/cloud', () => ({
  fetchHousehold: async () => ({ household: mockCloud.household, mutes: [] }),
  fetchSharedItemKeys: async () => mockCloud.sharedKeys,
}));
jest.mock('../../items/cloudStorage', () => ({
  currentUserId: async () => 'user-me',
  cloudLoadItems: async () => [],
  cloudLoadEntries: async () => [],
  cloudUpsertMany: async () => {},
  cloudPushEntries: async () => {},
  cloudDeleteMany: async () => {},
  cloudLoadTombstones: async () => [],
}));

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, name: id, category: 'Household', lastDoneDate: '2026-10-01',
    history: [{ id: `${id}-e`, date: '2026-10-01' }], repeatValue: null, repeatUnit: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
  };
}

const home = { id: HOME, name: 'Home', members: [{ userId: ME, displayName: 'Alex', role: 'member' }] };

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('@since_owner_v1', ME);
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({ userId: ME, household: home, mutes: [] }));
  await AsyncStorage.setItem('@since_v1_items', JSON.stringify({
    version: 3,
    items: [
      item('mine'),
      item('mine-shared', { householdId: HOME }),
      item('sams-shared', { ownerId: SAM, householdId: HOME }),
    ],
  }));
  await AsyncStorage.setItem('@since_sync_queue_v1', JSON.stringify({
    upserts: ['sams-shared'], deletes: [], entryUpserts: [{ itemId: 'sams-shared', entryId: 'x' }], entryDeletes: [],
  }));
  await AsyncStorage.setItem('@since_sync_cursor_v1', JSON.stringify({ userId: ME, items: '2026-10-01T00:00:00Z', entries: null }));
  mockCloud.household = home;
  mockCloud.sharedKeys = new Set([`${SAM}/sams-shared`]);
});

const ids = async () => (await loadItems()).map((i) => i.id).sort();

it('nothing changed: the list and queue are left alone', async () => {
  await syncNow();
  expect(await ids()).toEqual(['mine', 'mine-shared', 'sams-shared']);
});

it("after leaving (or being removed), the household's items and their queued changes go; personal items stay", async () => {
  mockCloud.household = null;
  await syncNow();

  expect(await ids()).toEqual(['mine']);
  const q = await loadQueue();
  expect(q.upserts).toEqual([]);
  expect(q.entryUpserts).toEqual([]);
  expect(q.deletes).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem('@since_household_v1'))!).household).toBeNull();
});

it('an item its creator made personal again goes from this phone', async () => {
  mockCloud.sharedKeys = new Set();
  await syncNow();
  expect(await ids()).toEqual(['mine', 'mine-shared']);
});

it('joining a household pulls everything again', async () => {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({ userId: ME, household: null, mutes: [] }));
  const before = await AsyncStorage.getItem('@since_sync_cursor_v1');
  await syncNow();
  // The cursor was cleared before this sync's pull, which then saved a fresh one
  expect(await AsyncStorage.getItem('@since_sync_cursor_v1')).not.toBe(before);
});
