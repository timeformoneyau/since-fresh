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
import { enqueueUpsert, enqueueDelete } from '../sync/queue';
import { syncInBackground } from '../sync/engine';
import { withoutCompletion, copyForRestore } from './undo';

export { canUndoDone } from './undo';

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
 * Every item is seeded with an initial completion event so the log starts
 * from the date the user says it was last done.
 */
export async function createItem(input: CreateItemInput): Promise<DerivedItem> {
  const now = new Date().toISOString();
  const history: CompletionEvent[] = [{ id: generateId(), date: input.lastDoneDate }];
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

/** Update fields on an existing item, persist, and reschedule its notifications. */
export async function updateItem(itemId: string, updates: UpdateItemInput): Promise<DerivedItem> {
  const items = await loadItems();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`Item not found: ${itemId}`);

  const updated: SinceItem = {
    ...existing,
    ...updates,
    id: existing.id,
    // History is append-only and owned by markItemDone — metadata edits
    // must never rewrite the completion log.
    history: existing.history,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await saveItems(items.map((i) => (i.id === itemId ? updated : i)));
  await scheduleItemNotifications(updated);

  await enqueueUpsert(updated.id);
  syncInBackground();

  return deriveItem(updated);
}

/**
 * Mark an item as done today (or on a specific date).
 *
 * Prepends a completion event. This is the only path that grows the history
 * log.
 */
export async function markItemDone(itemId: string, doneDate?: string): Promise<DerivedItem> {
  const date = doneDate ?? todayString();
  const items = await loadItems();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`Item not found: ${itemId}`);

  const updated: SinceItem = {
    ...existing,
    lastDoneDate: date,
    history: [{ id: generateId(), date }, ...existing.history],
    updatedAt: new Date().toISOString(),
  };

  await saveItems(items.map((i) => (i.id === itemId ? updated : i)));
  await scheduleItemNotifications(updated);

  await enqueueUpsert(updated.id);
  syncInBackground();

  return deriveItem(updated);
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

  const updated = withoutCompletion(existing, eventId, new Date().toISOString(), previousLastDoneDate);
  if (!updated) return deriveItem(existing);

  await saveItems(items.map((i) => (i.id === itemId ? updated : i)));
  await scheduleItemNotifications(updated);

  await enqueueUpsert(updated.id);
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
