import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createItem, updateItem, setLookedAfterBy } from '../service';
import { loadItems } from '../storage';
import { loadQueue } from '../../sync/queue';
import { saveHouseholdState } from '../../household/store';
import { itemToRow, rowToItem, type ItemRow } from '../cloudStorage';
import type { SinceItem } from '../../../types';
import { todayString } from '../../../utils/dateUtils';

/**
 * Who looks after a shared item (Shared load): the service refuses what the
 * server would refuse (005_looked_after_by.sql), changing it is queued for
 * sync like any field, and reminders are re-planned for this phone's account.
 */
const ME = 'user-me';
const SAM = 'user-sam';
const HOME = 'household-home';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  await saveHouseholdState({
    userId: ME,
    household: {
      id: HOME,
      name: 'Home',
      members: [
        { userId: ME, displayName: 'Alex', role: 'owner' },
        { userId: SAM, displayName: 'Sam', role: 'member' },
      ],
    },
    mutes: [],
  });
});

async function newItem(householdId: string | null = HOME) {
  // Done today, so its reminders are all still ahead
  const created = await createItem({
    name: 'Bins', category: 'Household', lastDoneDate: todayString(), repeatValue: 1, repeatUnit: 'weeks', householdId,
  });
  await AsyncStorage.removeItem('@since_sync_queue_v1');
  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  return created;
}

const scheduledFor = (id: string) =>
  jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.filter(([n]) => n.identifier?.includes(id));

it('a new shared item starts at Anyone and is reminded here', async () => {
  const created = await createItem({
    name: 'Bins', category: 'Household', lastDoneDate: todayString(), repeatValue: 1, repeatUnit: 'weeks', householdId: HOME,
  });
  expect(created.lookedAfterBy).toBeUndefined();
  expect(scheduledFor(created.id).length).toBeGreaterThan(0);
});

it('choosing someone else saves it, queues it for sync and stops reminders on this phone', async () => {
  const bins = await newItem();
  await setLookedAfterBy(bins.id, SAM);
  expect((await loadItems())[0].lookedAfterBy).toBe(SAM);
  expect((await loadQueue()).upserts).toEqual([bins.id]);
  expect(scheduledFor(bins.id)).toEqual([]);
});

it("I'll look after this: reminded here; back to Anyone: reminded here too", async () => {
  const bins = await newItem();
  await setLookedAfterBy(bins.id, ME);
  expect(scheduledFor(bins.id).length).toBeGreaterThan(0);
  await setLookedAfterBy(bins.id, null);
  expect((await loadItems())[0].lookedAfterBy).toBeNull();
});

it("someone outside the household, or anyone on a Just me item, is refused and nothing is queued", async () => {
  const bins = await newItem();
  await expect(setLookedAfterBy(bins.id, 'user-outsider')).rejects.toThrow();
  const passport = await newItem(null);
  await expect(setLookedAfterBy(passport.id, ME)).rejects.toThrow();
  expect((await loadQueue()).upserts).toEqual([]);
});

it('changing an item to Just me clears who looks after it', async () => {
  const bins = await newItem();
  await setLookedAfterBy(bins.id, SAM);
  const updated = await updateItem(bins.id, { householdId: null });
  expect(updated.lookedAfterBy).toBeNull();
});

it('a new shared item can be saved with someone looking after it', async () => {
  const created = await createItem({
    name: 'Gutters', category: 'Household', lastDoneDate: todayString(), repeatValue: 6, repeatUnit: 'months',
    householdId: HOME, lookedAfterBy: SAM,
  });
  expect(created.lookedAfterBy).toBe(SAM);
  expect(scheduledFor(created.id)).toEqual([]);
});

describe('cloud rows', () => {
  const item: SinceItem = {
    id: 'bins', name: 'Bins', category: 'Household', lastDoneDate: '2026-10-01',
    history: [{ id: 'e1', date: '2026-10-01' }], repeatValue: 1, repeatUnit: 'weeks',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };

  it("an item nobody has chosen for doesn't send the column (projects without migration 005 keep working)", () => {
    expect('looked_after_by' in itemToRow(item, ME)).toBe(false);
    expect('looked_after_by' in itemToRow({ ...item, householdId: HOME }, ME)).toBe(false);
  });

  it('a shared item sends who looks after it; a Just me item only ever sends null', () => {
    expect(itemToRow({ ...item, householdId: HOME, lookedAfterBy: SAM }, ME).looked_after_by).toBe(SAM);
    expect(itemToRow({ ...item, householdId: HOME, lookedAfterBy: null }, ME).looked_after_by).toBeNull();
    // Left over after an older build made it Just me: the server would refuse a person
    expect(itemToRow({ ...item, householdId: null, lookedAfterBy: SAM }, ME).looked_after_by).toBeNull();
  });

  it('pulled rows carry it when the project has the column, and nothing when it has not', () => {
    const row: ItemRow = {
      id: 'bins', user_id: SAM, name: 'Bins', category: 'Household', last_done_date: '2026-10-01',
      history: [], repeat_value: 1, repeat_unit: 'weeks', created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z', household_id: HOME,
    };
    expect('lookedAfterBy' in rowToItem(row, ME)).toBe(false);
    expect(rowToItem({ ...row, looked_after_by: ME }, ME).lookedAfterBy).toBe(ME);
    expect(rowToItem({ ...row, looked_after_by: null }, ME).lookedAfterBy).toBeNull();
  });
});
