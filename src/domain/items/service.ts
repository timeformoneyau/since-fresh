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
import { rescheduleAllNotifications } from '../../notifications/scheduler';
import { saveReminderTime } from '../../notifications/reminderTimeStore';
import type { ReminderTime } from '../../notifications/reminderTime';
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

import { toBackup, readBackup, planRestore, describeRestore } from '../backup/backup';
import { loadHouseholdState } from '../household/store';
import { canChangeSharing, canDelete, canLookAfter, isShared } from '../household/rules';
import { loadSnoozes, saveSnoozes } from '../snooze/store';
import { activeSnoozeUntil, canSnooze, makeSnooze, type SnoozeOption } from '../snooze/rules';

export { canUndoDone } from './undo';
export { BackupError } from '../backup/backup';
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
  const next = items.map((i) => (i.id === updated.id ? updated : i));
  await saveItems(next);
  await rescheduleAllNotifications(next);

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

/** Derived fields plus this phone's snooze, if any. */
async function withSnoozes(items: SinceItem[]): Promise<DerivedItem[]> {
  const snoozes = await loadSnoozes();
  const now = new Date();
  return items.map((i) => ({ ...deriveItem(i), snoozedUntil: activeSnoozeUntil(i, snoozes, now) }));
}

/** Load all items, sorted for display, with derived fields attached. */
export async function getDerivedItems(): Promise<DerivedItem[]> {
  const items = await loadItems();
  return withSnoozes(sortItems(items));
}

/** Load a single item by ID with derived fields. Returns null if not found. */
export async function getDerivedItemById(itemId: string): Promise<DerivedItem | null> {
  const items = await loadItems();
  const item = items.find((i) => i.id === itemId);
  return item ? (await withSnoozes([item]))[0] : null;
}

/**
 * "Not yet": quiet this item's reminders for a while, on this phone only
 * (snooze/rules.ts). The item itself is untouched, so nothing syncs. Only
 * for an item that is due or overdue. Returns the day reminders start again.
 */
export async function snoozeItem(itemId: string, option: SnoozeOption): Promise<string> {
  const { items, existing } = await loadOne(itemId);
  const now = new Date();
  if (!canSnooze(existing, now)) throw new Error('Only something that is due can be snoozed.');
  const snooze = makeSnooze(existing, option, now);
  await saveSnoozes({ ...(await loadSnoozes()), [itemId]: snooze });
  await rescheduleAllNotifications(items);
  return snooze.until;
}

/** Undo a snooze: reminders as before. */
export async function clearSnooze(itemId: string): Promise<void> {
  const { [itemId]: _gone, ...rest } = await loadSnoozes();
  await saveSnoozes(rest);
  await rescheduleAllNotifications(await loadItems());
  notifyItemsChanged();
}

/** Refused here, as the server would refuse it (005_looked_after_by.sql). */
const LOOK_AFTER_REFUSED = 'Only someone in the household can look after a shared item.';

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
    ...(input.householdId ? { householdId: input.householdId } : {}),
    ...(input.householdId && input.lookedAfterBy ? { lookedAfterBy: input.lookedAfterBy } : {}),
  };
  if (!canLookAfter(item, item.lookedAfterBy ?? null, await loadHouseholdState())) {
    throw new Error(LOOK_AFTER_REFUSED);
  }
  const all = [...(await loadItems()), item];
  await saveItems(all);
  await rescheduleAllNotifications(all);

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
  // The server refuses a sharing change from anyone but the item's creator
  // (004_households.sql); refused here so it never sits in the sync queue.
  if (
    updates.householdId !== undefined &&
    (updates.householdId ?? null) !== (existing.householdId ?? null) &&
    !canChangeSharing(existing, await loadHouseholdState())
  ) {
    throw new Error('Only the person who added this can change who it is for.');
  }
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
  // Just me: nobody looks after it (the server clears it too), and choosing
  // someone for it is refused
  if (!isShared(updated)) {
    if (updates.lookedAfterBy) throw new Error(LOOK_AFTER_REFUSED);
    if (updated.lookedAfterBy) updated = { ...updated, lookedAfterBy: null };
  }
  if (
    updated.lookedAfterBy !== existing.lookedAfterBy &&
    !canLookAfter(updated, updated.lookedAfterBy ?? null, await loadHouseholdState())
  ) {
    throw new Error(LOOK_AFTER_REFUSED);
  }
  if (lastDoneDate !== undefined && lastDoneDate !== existing.lastDoneDate) {
    const newest = sortNewestFirst(existing.history)[0];
    updated = updateEntry(updated, newest.id, { date: lastDoneDate }, todayString(), now);
    return persist(items, updated, { fields: true, entryChanged: newest.id });
  }

  return persist(items, updated, { fields: true });
}

/**
 * Say who looks after a shared item: a member, or null for Anyone. Any member
 * can, for anyone in the household. Only that person is reminded; it changes
 * nothing else about the item.
 */
export async function setLookedAfterBy(itemId: string, userId: string | null): Promise<DerivedItem> {
  return updateItem(itemId, { lookedAfterBy: userId });
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

  const next = items.map((i) => (i.id === itemId ? updated : i));
  await saveItems(next);
  await rescheduleAllNotifications(next);

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
  // Someone else's shared item can only be deleted by the household's owner
  if (deleted && !canDelete(deleted, await loadHouseholdState())) {
    throw new Error('Only the person who added this, or the household owner, can delete it.');
  }
  const remaining = items.filter((i) => i.id !== itemId);
  await saveItems(remaining);
  await rescheduleAllNotifications(remaining);

  await enqueueDelete(
    itemId,
    deleted && (deleted.ownerId || deleted.householdId)
      ? { ownerId: deleted.ownerId, householdId: deleted.householdId }
      : undefined,
  );
  syncInBackground();

  return deleted;
}

/**
 * Undo a delete: put the item back as it was, under a new id (the old id is
 * tombstoned once the delete syncs — see copyForRestore).
 */
export async function restoreDeletedItem(item: SinceItem): Promise<DerivedItem> {
  // Back under this account (a new id needs a new row, and only its own
  // rows can be added), still shared if it was.
  const { ownerId: _previousOwner, ...mine } = item;
  const restored = copyForRestore(mine, generateId(), new Date().toISOString());
  const items = await loadItems();
  const all = [...items, restored];
  await saveItems(all);
  await rescheduleAllNotifications(all);

  await enqueueUpsert(restored.id);
  syncInBackground();
  notifyItemsChanged();

  return deriveItem(restored);
}

// ─── Backup files (domain/backup/backup.ts) ─────────────────────────────────

/** The whole list as a backup file's contents. */
export async function exportBackup(): Promise<string> {
  return toBackup(await loadItems(), new Date().toISOString());
}

/**
 * Read a backup file and work out what restoring it would add. Changes
 * nothing. Throws BackupError, with a plain message, for a file that isn't a
 * backup. Pass the returned backup to applyRestore.
 */
export async function previewRestore(raw: string): Promise<{ backup: SinceItem[]; message: string | null }> {
  const backup = readBackup(raw);
  const plan = planRestore(await loadItems(), backup, generateId, new Date().toISOString());
  return { backup, message: describeRestore(plan) };
}

/**
 * Add what's in a backup and missing here: new items, and missing entries on
 * items already here. Never replaces anything. Worked out again against the
 * list as it is now, in case it changed while the preview was showing.
 * Recorded for sync like any change: new items whole, existing items by
 * their added entries only.
 */
export async function applyRestore(backup: SinceItem[]): Promise<void> {
  const items = await loadItems();
  const plan = planRestore(items, backup, generateId, new Date().toISOString());
  const changed = new Map(plan.extended.map((x) => [x.item.id, x.item]));
  const all = [...items.map((i) => changed.get(i.id) ?? i), ...plan.added];
  await saveItems(all);
  await rescheduleAllNotifications(all);

  for (const item of plan.added) await enqueueUpsert(item.id);
  for (const { item, entryIds } of plan.extended) {
    for (const entryId of entryIds) await enqueueEntryUpsert({ itemId: item.id, entryId });
  }
  syncInBackground();
  notifyItemsChanged();
}

/** Change the time of day reminders go out, and move every scheduled one to it. */
export async function setReminderTime(time: ReminderTime): Promise<void> {
  await saveReminderTime(time);
  await rescheduleAllNotifications(await loadItems());
}

/** Reschedule every reminder (after "Remind me about this" changes). */
export async function refreshReminders(): Promise<void> {
  await rescheduleAllNotifications(await loadItems());
}
