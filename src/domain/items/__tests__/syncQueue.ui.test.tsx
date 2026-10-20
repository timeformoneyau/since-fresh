import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createItem,
  updateItem,
  markItemDone,
  undoMarkDone,
  addHistoryEntry,
  updateHistoryEntry,
  deleteHistoryEntry,
  deleteItem,
} from '../service';
import { loadQueue } from '../../sync/queue';

/**
 * What each change records for sync (sync plan, PR 3): the item's fields
 * only when they changed, and history entries one by one, so marking done on
 * one phone never sends its copy of the fields over another phone's edit.
 * Runs local-only (jest.ui.setup.js), so the queue just fills up.
 */
beforeEach(() => AsyncStorage.clear());

async function newItem() {
  const created = await createItem({
    name: 'Gutters', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: 6, repeatUnit: 'months',
  });
  // Start each check from an empty queue
  await AsyncStorage.removeItem('@since_sync_queue_v1');
  return created;
}

it('creating an item queues the item (its first entry goes with it)', async () => {
  const created = await createItem({
    name: 'Bins', category: 'Household', lastDoneDate: '2026-10-01', repeatValue: null, repeatUnit: null,
  });
  const q = await loadQueue();
  expect(q.upserts).toEqual([created.id]);
  expect(q.entryUpserts).toEqual([]);
});

it('marking done queues just the new entry, not the fields', async () => {
  const it = await newItem();
  const { entryId } = await markItemDone(it.id, '2026-10-10');
  const q = await loadQueue();
  expect(q.upserts).toEqual([]);
  expect(q.entryUpserts).toEqual([{ itemId: it.id, entryId }]);
});

it('undoing done queues the entry as deleted, replacing its unsent add', async () => {
  const it = await newItem();
  const { entryId } = await markItemDone(it.id, '2026-10-10');
  await undoMarkDone(it.id, entryId!, '2026-09-01');
  const q = await loadQueue();
  expect(q.entryUpserts).toEqual([]);
  expect(q.entryDeletes).toEqual([{ itemId: it.id, entryId }]);
});

it('adding, editing and deleting entries on the item screen queue those entries', async () => {
  const it = await newItem();
  const added = await addHistoryEntry(it.id, '2026-09-15', 'Ladder');
  const addedId = added.history.find((e) => e.date === '2026-09-15')!.id;
  const firstId = it.history[0].id;
  await updateHistoryEntry(it.id, firstId, { note: 'First time' });
  await deleteHistoryEntry(it.id, addedId);

  const q = await loadQueue();
  expect(q.upserts).toEqual([]);
  expect(q.entryUpserts).toEqual([{ itemId: it.id, entryId: firstId }]);
  expect(q.entryDeletes).toEqual([{ itemId: it.id, entryId: addedId }]);
});

it('editing the item queues its fields; changing the date also queues the newest entry', async () => {
  const it = await newItem();
  await updateItem(it.id, { name: 'Clean gutters', lastDoneDate: '2026-09-05' });
  const q = await loadQueue();
  expect(q.upserts).toEqual([it.id]);
  expect(q.entryUpserts).toEqual([{ itemId: it.id, entryId: it.history[0].id }]);
});

it("deleting the item queues the delete and drops its entries' changes", async () => {
  const it = await newItem();
  await markItemDone(it.id, '2026-10-10');
  await deleteItem(it.id);
  const q = await loadQueue();
  expect(q.deletes).toEqual([it.id]);
  expect(q.entryUpserts).toEqual([]);
});
