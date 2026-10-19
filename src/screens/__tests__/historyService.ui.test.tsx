import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  createItem,
  markItemDone,
  addHistoryEntry,
  updateHistoryEntry,
  deleteHistoryEntry,
  getDerivedItemById,
} from '../../domain/items/service';

// The real service, storage and notification engine, with the native
// notifications module mocked (jest.ui.setup.js).
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  schedule.mockClear();
});

/** Trigger dates of the notifications scheduled since the last clear. */
function scheduledDates(): number[] {
  return schedule.mock.calls.map(([req]) => new Date(req.trigger.date).getTime()).sort();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function repeating() {
  // A year-long cycle done 100 days ago: its reminders are all in the future
  const item = await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: daysAgo(100), repeatValue: 1, repeatUnit: 'years' });
  schedule.mockClear();
  return item;
}

it('marking done twice on the same day adds one entry', async () => {
  const item = await repeating();
  const first = await markItemDone(item.id);
  const second = await markItemDone(item.id);
  expect(first.entryId).not.toBeNull();
  expect(second.entryId).toBeNull();
  expect((await getDerivedItemById(item.id))!.history).toHaveLength(2);
});

it('every history change saves and reschedules the item\'s notifications', async () => {
  const item = await repeating();

  await addHistoryEntry(item.id, '2020-01-01', 'Serviced');
  expect(schedule).toHaveBeenCalled();
  const saved = (await getDerivedItemById(item.id))!;
  const added = saved.history.find((e) => e.date === '2020-01-01')!;
  expect(added.note).toBe('Serviced');
  // An older entry doesn't move the due date
  expect(saved.lastDoneDate).toBe(item.lastDoneDate);

  const remindersBefore = scheduledDates();
  expect(remindersBefore).not.toEqual([]);

  schedule.mockClear();
  const newest = (await getDerivedItemById(item.id))!.history[0];
  await updateHistoryEntry(item.id, newest.id, { date: daysAgo(50) });
  // Editing the newest entry moves last done, and the reminders with it
  expect((await getDerivedItemById(item.id))!.lastDoneDate).toBe(daysAgo(50));
  const remindersAfter = scheduledDates();
  expect(remindersAfter).toHaveLength(remindersBefore.length);
  expect(remindersAfter[0]).toBeGreaterThan(remindersBefore[0]);

  schedule.mockClear();
  await deleteHistoryEntry(item.id, added.id);
  expect((await getDerivedItemById(item.id))!.history).toHaveLength(1);
  expect(schedule).toHaveBeenCalled();
});

it('the date rules are enforced by the service, not only the screen', async () => {
  const item = await repeating();
  await expect(addHistoryEntry(item.id, '2999-01-01')).rejects.toMatchObject({ code: 'future' });
  const only = (await getDerivedItemById(item.id))!.history[0];
  await expect(deleteHistoryEntry(item.id, only.id)).rejects.toMatchObject({ code: 'last-entry' });
});
