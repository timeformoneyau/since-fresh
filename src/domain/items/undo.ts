/**
 * Pure helpers for undoing "done" and undoing a delete. No I/O: service.ts
 * persists the result and records it for sync.
 */

import type { SinceItem } from '../../types';
import { addedDay } from './due.ts';

/** True when the latest completion can be undone (the entry from adding the item always stays). */
export function canUndoDone(item: SinceItem): boolean {
  return item.history.length > 1;
}

/**
 * The item without one completion event, or null when there is nothing to
 * undo (the event is already gone, or it is the only entry left).
 *
 * lastDoneDate goes back to `previousLastDoneDate` when given (captured just
 * before marking done), otherwise to the newest remaining entry. Removing an
 * older entry leaves lastDoneDate alone. updatedAt is stamped so sync, which
 * keeps the newest change, carries the undo to the cloud.
 *
 * Date items ("until it's due", due.ts): `previousDueDate` (captured just
 * before marking done; null if it had none) puts the due date back, since
 * Done moved it on or cleared it. A date item may lose its only entry: it
 * goes back to "not done yet".
 */
export function withoutCompletion(
  item: SinceItem,
  eventId: string,
  now: string,
  previousLastDoneDate?: string,
  previousDueDate?: string | null,
): SinceItem | null {
  const index = item.history.findIndex((e) => e.id === eventId);
  const dueAfter = previousDueDate !== undefined ? previousDueDate : item.dueDate ?? null;
  if (index === -1 || (item.history.length <= 1 && typeof dueAfter !== 'string')) return null;

  const history = item.history.filter((e) => e.id !== eventId);
  const restored: SinceItem =
    previousDueDate !== undefined && previousDueDate !== (item.dueDate ?? null)
      ? { ...item, dueDate: previousDueDate }
      : item;
  const lastDoneDate =
    history.length === 0
      ? addedDay(restored)
      : index === 0 ? previousLastDoneDate ?? history[0].date : item.lastDoneDate;

  return { ...restored, lastDoneDate, history, updatedAt: now };
}

/**
 * A deleted item, ready to put back. It takes a new id: once the delete has
 * synced, the old id is tombstoned in the cloud and every later sync would
 * drop an item carrying it. Everything the user sees is kept, history included.
 */
export function copyForRestore(item: SinceItem, newId: string, now: string): SinceItem {
  return { ...item, id: newId, updatedAt: now };
}
