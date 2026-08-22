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

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
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
 * Repeat-mode items are seeded with an initial completion event so the log
 * starts from the date the user says it was last done. Expiry-mode items
 * (scanned food) start with an empty history — they are replaced by the next
 * scan rather than accumulating completions.
 */
export async function createItem(input: CreateItemInput): Promise<DerivedItem> {
  const now = new Date().toISOString();
  const expiryDate = input.expiryDate ?? null;
  const history: CompletionEvent[] = expiryDate
    ? []
    : [{ id: generateId(), date: input.lastDoneDate }];
  const item: SinceItem = {
    id: generateId(),
    name: input.name,
    category: input.category,
    lastDoneDate: input.lastDoneDate,
    history,
    repeatValue: input.repeatValue,
    repeatUnit: input.repeatUnit,
    expiryDate,
    source: input.source ?? 'manual',
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
 * Two distinct behaviours, decided by the item's state *before* the mutation:
 *
 *   Expiry-mode (a scanned food item): clear the expiry back to manual — the
 *   next instance of the food needs a fresh scan rather than reusing a stale
 *   date — and do NOT append to history. A scan replaces the previous state
 *   rather than adding to it, so food carries no completion log.
 *
 *   Repeat-mode (everything else): prepend a completion event. This is the
 *   only path that grows the history log.
 */
export async function markItemDone(itemId: string, doneDate?: string): Promise<DerivedItem> {
  const date = doneDate ?? todayString();
  const items = await loadItems();
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`Item not found: ${itemId}`);

  const wasExpiryMode = existing.expiryDate !== null;

  const updated: SinceItem = {
    ...existing,
    lastDoneDate: date,
    history: wasExpiryMode
      ? existing.history
      : [{ id: generateId(), date }, ...existing.history],
    expiryDate: null,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };

  await saveItems(items.map((i) => (i.id === itemId ? updated : i)));
  await scheduleItemNotifications(updated);

  await enqueueUpsert(updated.id);
  syncInBackground();

  return deriveItem(updated);
}

/**
 * Delete an item and fully recompute notifications for the remaining set.
 * Full recompute is needed because grouped overdue counts may change.
 */
export async function deleteItem(itemId: string): Promise<void> {
  const items = await loadItems();
  const remaining = items.filter((i) => i.id !== itemId);
  await saveItems(remaining);
  await rescheduleAllNotifications(remaining);

  await enqueueDelete(itemId);
  syncInBackground();
}
