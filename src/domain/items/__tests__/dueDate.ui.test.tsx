import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createItem, updateItem, getDerivedItemById, markItemDone, undoMarkDone } from '../service';
import { loadItems } from '../storage';
import { loadQueue } from '../../sync/queue';
import { todayString } from '../../../utils/dateUtils';

/**
 * "Until it's due" through the real service, storage and notification
 * engine (native notifications mocked, local-only: jest.ui.setup.js).
 */
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  schedule.mockClear();
});

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const rego = (dueDate = inDays(40)) =>
  createItem({
    name: 'Car rego', category: 'Auto', lastDoneDate: '2020-01-01', repeatValue: 1, repeatUnit: 'years', dueDate,
  });

describe('creating a date item', () => {
  it('saves its due date with an empty history; last done is ignored', async () => {
    const created = await rego();
    const [saved] = await loadItems();
    expect(saved.dueDate).toBe(inDays(40));
    expect(saved.history).toEqual([]);
    // The day it was added, not the date the form sent
    expect(saved.lastDoneDate).toBe(todayString());
    expect(created.status.daysUntilDue).toBe(40);
  });

  it('is queued for sync whole, and reminded', async () => {
    const created = await rego();
    expect((await loadQueue()).upserts).toEqual([created.id]);
    const ids = schedule.mock.calls.map(([req]) => req.identifier);
    expect(ids).toEqual(expect.arrayContaining([`since_${created.id}_coming_up`, `since_${created.id}_due`]));
  });

  it('a one-off date item is reminded too', async () => {
    const created = await createItem({
      name: 'Cancel trial', category: 'Finance', lastDoneDate: todayString(), repeatValue: null, repeatUnit: null, dueDate: inDays(90),
    });
    expect(created.status.label).toBe('All good');
    expect(schedule.mock.calls.map(([req]) => req.identifier)).toContain(`since_${created.id}_due`);
  });

  it('a past due date is allowed and shows as overdue', async () => {
    const created = await rego(inDays(-5));
    expect(created.status.daysUntilDue).toBe(-5);
    expect(created.status.label).toBe("It's been a while");
  });

  it('a date that is not real is refused, and nothing is saved', async () => {
    await expect(rego('2026-02-30')).rejects.toThrow('Choose a due date.');
    expect(await loadItems()).toEqual([]);
  });

  it('"since" items are made exactly as before', async () => {
    const created = await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-09-01', repeatValue: 6, repeatUnit: 'months' });
    expect(created.history).toHaveLength(1);
    expect(created.lastDoneDate).toBe('2026-09-01');
    expect('dueDate' in created).toBe(false);
  });
});

describe('editing a date item', () => {
  it('its due date can change, and the reminders move with it', async () => {
    const created = await rego();
    schedule.mockClear();
    await AsyncStorage.removeItem('@since_sync_queue_v1');
    const updated = await updateItem(created.id, { dueDate: inDays(60), lastDoneDate: todayString() });
    expect(updated.dueDate).toBe(inDays(60));
    expect(updated.status.daysUntilDue).toBe(60);
    expect(updated.history).toEqual([]);
    expect((await loadQueue()).upserts).toEqual([created.id]);
    expect(schedule).toHaveBeenCalled();
  });

  it('its repeat can change too', async () => {
    const created = await rego();
    const updated = await updateItem(created.id, { repeatValue: null, repeatUnit: null });
    expect(updated.dueDate).toBe(inDays(40));
    expect(updated.repeatValue).toBeNull();
  });

  it("an item can't switch between since and until here", async () => {
    const since = await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-09-01', repeatValue: 6, repeatUnit: 'months' });
    await expect(updateItem(since.id, { dueDate: inDays(10) })).rejects.toThrow(/can't switch/);
    expect((await getDerivedItemById(since.id))!.dueDate).toBeUndefined();
  });

  it('a date that is not real is refused', async () => {
    const created = await rego();
    await expect(updateItem(created.id, { dueDate: 'soon' })).rejects.toThrow('Choose a due date.');
    expect((await getDerivedItemById(created.id))!.dueDate).toBe(inDays(40));
  });
});

describe('Done on a date item', () => {
  it('repeating: adds an entry for today and moves the due date on a year, from the old due date', async () => {
    const created = await rego(inDays(40));
    await AsyncStorage.removeItem('@since_sync_queue_v1');
    const { item, entryId } = await markItemDone(created.id);
    expect(entryId).not.toBeNull();
    expect(item.history.map((e) => e.date)).toEqual([todayString()]);
    const next = new Date();
    next.setDate(next.getDate() + 40);
    next.setFullYear(next.getFullYear() + 1);
    expect(item.dueDate).toBe(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
    );
    // The due date is a field: it syncs with the entry
    const q = await loadQueue();
    expect(q.upserts).toEqual([created.id]);
    expect(q.entryUpserts).toEqual([{ itemId: created.id, entryId }]);
  });

  it('repeating and overdue: rolled forward until it is in the future', async () => {
    const created = await rego(inDays(-400));
    const { item } = await markItemDone(created.id);
    expect(item.status.daysUntilDue).toBeGreaterThan(0);
    expect(item.status.daysUntilDue).toBeLessThanOrEqual(366);
  });

  it('one-off: adds an entry and becomes a once-off record', async () => {
    const created = await createItem({
      name: 'Cancel trial', category: 'Finance', lastDoneDate: todayString(), repeatValue: null, repeatUnit: null, dueDate: inDays(90),
    });
    schedule.mockClear();
    const { item } = await markItemDone(created.id);
    expect(item.dueDate).toBeNull();
    expect(item.history).toHaveLength(1);
    expect(item.status.label).toBeNull();
    // Rescheduled: a once-off record has no reminders
    expect(schedule).not.toHaveBeenCalled();
  });

  it('Undo puts the due date back and leaves it not done yet', async () => {
    const created = await rego(inDays(40));
    const before = (await getDerivedItemById(created.id))!;
    const { entryId } = await markItemDone(created.id);
    await AsyncStorage.removeItem('@since_sync_queue_v1');
    const undone = await undoMarkDone(created.id, entryId!, before.lastDoneDate, before.dueDate ?? null);
    expect(undone.dueDate).toBe(inDays(40));
    expect(undone.history).toEqual([]);
    expect(undone.lastDoneDate).toBe(todayString());
    const q = await loadQueue();
    expect(q.upserts).toEqual([created.id]);
    expect(q.entryDeletes).toEqual([{ itemId: created.id, entryId }]);
  });

  it('Undo on a trial that became once off makes it a date item again', async () => {
    const created = await createItem({
      name: 'Cancel trial', category: 'Finance', lastDoneDate: todayString(), repeatValue: null, repeatUnit: null, dueDate: inDays(90),
    });
    const { entryId } = await markItemDone(created.id);
    const undone = await undoMarkDone(created.id, entryId!, todayString(), inDays(90));
    expect(undone.dueDate).toBe(inDays(90));
    expect(undone.status.label).toBe('All good');
  });

  it('a "since" item marked done queues only the entry, as before', async () => {
    const since = await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-01-01', repeatValue: 6, repeatUnit: 'months' });
    await AsyncStorage.removeItem('@since_sync_queue_v1');
    const { item } = await markItemDone(since.id);
    expect('dueDate' in item).toBe(false);
    expect((await loadQueue()).upserts).toEqual([]);
  });
});

describe('the cloud row (migration 007)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { itemToRow, rowToItem } = require('../cloudStorage');

  it('a date item sends due_date and comes back with it', async () => {
    const created = await rego(inDays(40));
    const row = itemToRow(created, 'me');
    expect(row.due_date).toBe(inDays(40));
    expect(row.last_done_date).toBe(todayString());
    const back = rowToItem({ ...row, server_updated_at: 'x' }, 'me');
    expect(back.dueDate).toBe(inDays(40));
    expect(back.history).toEqual([]);
  });

  it('a "since" item never sends due_date, so it works before 007 runs', async () => {
    const since = await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-09-01', repeatValue: 6, repeatUnit: 'months' });
    expect('due_date' in itemToRow(since, 'me')).toBe(false);
    // A row from a project without 007 has no due_date: no dueDate either
    const { due_date: _none, ...older } = itemToRow(since, 'me');
    expect('dueDate' in rowToItem(older, 'me')).toBe(false);
  });

  it('a one-off done (dueDate cleared) sends null, so the cloud clears it too', async () => {
    const trial = await createItem({ name: 'Trial', category: 'Finance', lastDoneDate: todayString(), repeatValue: null, repeatUnit: null, dueDate: inDays(9) });
    const { item } = await markItemDone(trial.id);
    expect(itemToRow(item, 'me').due_date).toBeNull();
  });
});
