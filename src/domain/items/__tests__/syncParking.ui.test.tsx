import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../../App';
import { createItem, getDerivedItemById, getSyncProblem, countSyncProblems, deleteItem } from '../service';
import { loadQueue } from '../../sync/queue';
import { LIMITS } from '../../sync/limits';

/**
 * A change the server refused for good (a size limit) is parked: the item
 * says so and what to change, and editing it tries again. Runs local-only,
 * so the parking is put in the queue as a sync would leave it.
 */
const QUEUE_KEY = '@since_sync_queue_v1';
const LIST_LOADS = { timeout: 5000 };

beforeEach(() => AsyncStorage.clear());

/** An item with a name over the limit, as an older build or a paste could leave it, parked by a sync. */
async function parkedLongName() {
  const long = 'Clean the gutters '.repeat(30).trim(); // ~540 characters
  const created = await createItem({ name: long, category: 'Household', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  const q = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '{}');
  q.parked = { [created.id]: { code: 'SN001', updatedAt: created.updatedAt } };
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  return created;
}

it('a parked item says it can\'t sync yet and how to fix it; the data stays', async () => {
  const created = await parkedLongName();
  expect(await getSyncProblem(created.id)).toBe('This name is too long to sync. Shorten it and it will go through.');
  expect(await countSyncProblems()).toBe(1);

  render(<App />);
  fireEvent.press(await screen.findByTestId(`item-${created.name}-history`, {}, LIST_LOADS));
  const notice = await screen.findByTestId('detail-sync-problem');
  expect(notice).toHaveTextContent(/Can't sync yet/);
  expect(notice).toHaveTextContent(/Shorten it and it will go through/);
  expect((await getDerivedItemById(created.id))!.name).toBe(created.name);
});

it('editing the item clears the parking, so the next sync tries again', async () => {
  const created = await parkedLongName();
  render(<App />);
  fireEvent.press(await screen.findByTestId(`item-${created.name}-edit`, {}, LIST_LOADS));

  // The saved long name shows in full and can be shortened
  const input = await screen.findByTestId('edit-name-input');
  expect(input.props.value).toBe(created.name);
  expect(input.props.maxLength).toBeGreaterThanOrEqual(created.name.length);
  fireEvent.changeText(input, 'Gutters');
  fireEvent.press(screen.getByTestId('edit-save-button'));

  await waitFor(async () => expect(await getSyncProblem(created.id)).toBeNull());
  expect(await countSyncProblems()).toBe(0);
  const q = await loadQueue();
  expect(q.upserts).toContain(created.id);
});

it('deleting a parked item removes its parking with it', async () => {
  const created = await parkedLongName();
  await deleteItem(created.id);
  const q = await loadQueue();
  expect(q.parked).toBeUndefined();
  expect(q.deletes).toEqual([created.id]);
});

it("an item that isn't parked shows no notice", async () => {
  await createItem({ name: 'Bins', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Bins-history', {}, LIST_LOADS));
  await screen.findByTestId('detail-status-card');
  expect(screen.queryByTestId('detail-sync-problem')).toBeNull();
});

it('a queue saved by the current release (no parked field) still loads and keeps its changes', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify({
    upserts: ['a'], deletes: ['b'], deleteMeta: { b: { ownerId: 'sam', householdId: 'home' } },
    entryUpserts: [{ itemId: 'a', entryId: 'e1' }], entryDeletes: [],
  }));
  const q = await loadQueue();
  expect(q).toEqual({
    upserts: ['a'], deletes: ['b'], deleteMeta: { b: { ownerId: 'sam', householdId: 'home' } },
    entryUpserts: [{ itemId: 'a', entryId: 'e1' }], entryDeletes: [],
  });
});

it('the name field stops at the server limit, so ordinary use never hits it', async () => {
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  await screen.findByTestId('item-Boiler', {}, LIST_LOADS);
  fireEvent.press(screen.getByTestId('main-add-button'));
  expect((await screen.findByTestId('add-name-input')).props.maxLength).toBe(LIMITS.name);
});

it('the history note field stops at 5,000 characters', async () => {
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Boiler-history', {}, LIST_LOADS));
  fireEvent.press(await screen.findByTestId('history-edit-0'));
  expect((await screen.findByTestId('entry-note-input')).props.maxLength).toBe(LIMITS.note);
});
