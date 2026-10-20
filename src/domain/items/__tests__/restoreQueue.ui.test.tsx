import AsyncStorage from '@react-native-async-storage/async-storage';
import { createItem, exportBackup, previewRestore, applyRestore, markItemDone, getDerivedItems } from '../service';
import { loadQueue } from '../../sync/queue';

// Restoring a backup is recorded for sync like any change: new items whole,
// entries added to items already here one by one (their fields untouched).
beforeEach(() => AsyncStorage.clear());

it('restoring queues new items, and only the added entries of existing ones', async () => {
  const gutters = await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  await markItemDone(gutters.id, '2026-09-01');
  const backup = await exportBackup();

  // The phone loses the later entry and gains nothing else; then restore
  await AsyncStorage.clear();
  await createItem({ name: 'Bins', category: 'Household', lastDoneDate: '2026-10-01', repeatValue: null, repeatUnit: null });
  await AsyncStorage.setItem('@since_v1_items', JSON.stringify({
    version: 3,
    items: [{ ...gutters, history: gutters.history }, ...JSON.parse((await AsyncStorage.getItem('@since_v1_items'))!).items],
  }));
  await AsyncStorage.removeItem('@since_sync_queue_v1');

  const { backup: items, message } = await previewRestore(backup);
  expect(message).toBe('1 entry. Add to your list?');
  await applyRestore(items);

  const list = await getDerivedItems();
  expect(list.find((i) => i.id === gutters.id)!.history).toHaveLength(2);
  const q = await loadQueue();
  expect(q.upserts).toEqual([]);
  expect(q.entryUpserts).toHaveLength(1);
  expect(q.entryUpserts[0].itemId).toBe(gutters.id);
});
