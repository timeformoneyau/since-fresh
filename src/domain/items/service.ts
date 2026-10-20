/**
 * Item Service — the single entry point for all item mutations.
 *
 * Screens must not import directly from storage, notifications, or sync.
 * All persistence, notification, and sync coordination lives here.
 *
 * Local-first (decision D1, option B): every mutation writes to AsyncStorage
 * and schedules notifications synchronously, then records the change in the
 * sync queue and kicks off a background sync. Nothing here awaits the network,
 * so every operation succeeds offline and the UI is never blocked by it.
 */

import { randomUUID } from 'expo-crypto';
import { SinceItem, CompletionEvent } from '../../types';
import { CreateItemInput, UpdateItemInput, DerivedItem } from './types';
import { loadItems, saveItems } from './storage';
import { deriveItem } from './derive';
import { sortItems } from '../../utils/statusUtils';
import { todayString } from '../../utils/dateUtils';
import {
  scheduleItemNotifications,
  rescheduleAllNotifications,
} from '../../notifications/scheduler';
import { enqueueUpsert, enqueueDelete, enqueueEntryUpsert, enqueueEntryDelete } from '../sync/queue';
import { syncInBackground } from '../sync/engine';
import { withoutCompletion, copyForRestore } from './undo';
import {
  withHistory,
  hasEntryOn,
  addEntry,
  updateEntry,
  deleteEntry,
  sortNewestFirst,
} from './history';

export { canUndoDone } from './undo';
export { HistoryError, dateBounds, usualIntervalDays, gapsNewestFirst } from './history';

type ItemsListener = () => void;
const listeners = new Set<ItemsListener>();

/**
 * Subscribe to changes made by an undo (from a toast, possibly while the list
 * is already on screen). Returns an unsubscribe function.
 */
export function onItemsChanged(listener: ItemsListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyItemsChanged(): void {
  listeners.forEach((l) => l());
}

/** New ids are UUIDs. Ids created by earlier builds stay as they are. */
function generateId(): string {
  return randomUUID();
}

/**
 * What a change touched, so sync sends just that (sync/queueOps.ts): the
 * item's own fields, and/or one history entry. Marking done doesn't touch the
 * fields, so it never sends this phone's copy of them over another phone's
 * newer edit.
 */
type Change = { fields?: boolean; entryChanged?: string; entryDeleted?: string };

/** Save one changed item, reschedule its notifications and record it for sync. */
async function persist(items: SinceItem[], updated: SinceItem, change: Change): Promise<DerivedItem> {
  await saveItems(items.map((i) => (i.id === updated.id ? updated : i)));
  await scheduleItemNotifications(updated);

  if (change.fields) await enqueueUpsert(updated.id);
  if (change.entryChanged) await enqueueEntryUpsert({ itemId: updated.id, entryId: change.entryChanged });
  if (change.entryDeleted) await enqueueEntryDelete({ itemId: updated.id, entryId: change.entryDeleted });
  syncInBackground();

  return deriveItem(updated);
}

async function loadOne(itemId: string): Promise<{ items: SinceItem[]; existing: SinceItem }> {
  const items = await loadItems();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`Item not found: ${itemId}`);
  return { items, existing };
}

/** Load all items, sorted for display, with derived fields attached. */
export async function getDerivedItems(): Promise<DerivedItem[]> {
  const items = await loadItems();
  return sortItems(items).map(deriveItem);
}

/** Load a single item by ID with derived fields. Returns null if not found. */
export async function getDerivedItemById(itemId: string): Promise<DerivedItem | null> {
  const items = await loadItems();
  const item = items.find((i) => i.id === itemId);
  return item ? deriveItem(item) : null;
}

/**
 * Create a new item, persist it, and schedule its notifications.
 *
 * Every item is seeded with an initial history entry, so the log starts
 * from the date the user says it was last done.
 */
export async function createItem(input: CreateItemInput): Promise<DerivedItem> {
  const now = new Date().toISOString();
  const history: CompletionEvent[] = [{ id: generateId(), date: input.lastDoneDate, createdAt: now }];
  const item: SinceItem = {
    id: generateId(),
    name: input.name,
    category: input.category,
    lastDoneDate: input.lastDoneDate,
    history,
    repeatValue: input.repeatValue,
    repeatUnit: input.repeatUnit,
    createdAt: now,
    updatedAt: now,
  };
  const existing = await loadItems();
  await saveItems([...existing, item]);
  await scheduleItemNotifications(item);

  await enqueueUpsert(item.id);
  syncInBackground();

  return deriveItem(item);
}

/**
 * Update fields on an existing item, persist, and reschedule its
 * notifications. Switching between Repeats and Once off keeps the history.
 *
 * A changed lastDoneDate edits the newest history entry (within the same
 * bounds as editing it on the item screen), since lastDoneDate always comes
 * from the history. Throws HistoryError when the date isn't allowed.
 */
export async function updateItem(itemId: string, updates: UpdateItemInput): Promise<DerivedItem> {
  const { items, existing } = await loadOne(itemId);
  const now = new Date().toISOString();
  const { lastDoneDate, ...fields } = updates;

  let updated: SinceItem = {
    ...existing,
    ...fields,
    id: existing.id,
    history: existing.history,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
  if (lastDoneDate !== undefined && lastDoneDate !== existing.lastDoneDate) {
    const newest = sortNewestFirst(existing.history)[0];
    updated = updateEntry(updated, newest.id, { date: lastDoneDate }, todayString(), now);
    return persist(items, updated, { fields: true, entryChanged: newest.id });
  }

  return persist(items, updated, { fields: true });
}

/**
 * Mark an item as done today (or on a specific date): adds a history entry.
 * Doing it twice on the same day changes nothing, and entryId is then null
 * (there's nothing to undo).
 */
export async function markItemDone(
  itemId: string,
  doneDate?: string,
): Promise<{ item: DerivedItem; entryId: string | null }> {
  const date = doneDate ?? todayString();
  const { items, existing } = await loadOne(itemId);
  if (hasEntryOn(existing, date)) return { item: deriveItem(existing), entryId: null };

  const entryId = generateId();
  const updated = addEntry(existing, { id: entryId, date }, todayString(), new Date().toISOString());
  return { item: await persist(items, updated, { entryChanged: entryId }), entryId };
}

/** Add a past entry ("Did it on another day?"). Throws HistoryError for a future date. */
export async function addHistoryEntry(itemId: string, date: string, note?: string): Promise<DerivedItem> {
  const { items, existing } = await loadOne(itemId);
  const entryId = generateId();
  const updated = addEntry(existing, { id: entryId, date, note }, todayString(), new Date().toISOString());
  return persist(items, updated, { entryChanged: entryId });
}

/**
 * Change an entry's date and/or note. The date must stay between the entries
 * either side (today for the newest). Throws HistoryError otherwise.
 */
export async function updateHistoryEntry(
  itemId: string,
  entryId: string,
  changes: { date?: string; note?: string },
): Promise<DerivedItem> {
  const { items, existing } = await loadOne(itemId);
  const updated = updateEntry(existing, entryId, changes, todayString(), new Date().toISOString());
  return persist(items, updated, { entryChanged: entryId });
}

/** Delete an entry. The last one can't go (HistoryError 'last-entry'). */
export async function deleteHistoryEntry(itemId: string, entryId: string): Promise<DerivedItem> {
  const { items, existing } = await loadOne(itemId);
  const updated = deleteEntry(existing, entryId, new Date().toISOString());
  return persist(items, updated, { entryDeleted: entryId });
}

/**
 * Undo a completion recorded by markItemDone (see undo.ts for the rules).
 * Returns the item unchanged when there is nothing to undo.
 */
export async function undoMarkDone(
  itemId: string,
  eventId: string,
  previousLastDoneDate?: string,
): Promise<DerivedItem> {
  const items = await loadItems();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`Item not found: ${itemId}`);

  const now = new Date().toISOString();
  const undone = withoutCompletion(existing, eventId, now, previousLastDoneDate);
  if (!undone) return deriveItem(existing);
  const updated = withHistory(undone, undone.history, now);

  await saveItems(items.map((i) => (i.id === itemId ? updated : i)));
  await scheduleItemNotifications(updated);

  await enqueueEntryDelete({ itemId: updated.id, entryId: eventId });
  syncInBackground();
  notifyItemsChanged();

  return deriveItem(updated);
}

/**
 * Delete an item and fully recompute notifications for the remaining set.
 * Full recompute is needed because grouped overdue counts may change.
 * Returns the deleted item so it can be put back with restoreDeletedItem.
 */
export async function deleteItem(itemId: string): Promise<SinceItem | null> {
  const items = await loadItems();
  const deleted = items.find((i) => i.id === itemId) ?? null;
  const remaining = items.filter((i) => i.id !== itemId);
  await saveItems(remaining);
  await rescheduleAllNotifications(remaining);

  await enqueueDelete(itemId);
  syncInBackground();

  return deleted;
}

/**
 * Undo a delete: put the item back as it was, under a new id (the old id is
 * tombstoned once the delete syncs — see copyForRestore).
 */
export async function restoreDeletedItem(item: SinceItem): Promise<DerivedItem> {
  const restored = copyForRestore(item, generateId(), new Date().toISOString());
  const items = await loadItems();
  const all = [...items, restored];
  await saveItems(all);
  await rescheduleAllNotifications(all);

  await enqueueUpsert(restored.id);
  syncInBackground();
  notifyItemsChanged();

  return deriveItem(restored);
}
