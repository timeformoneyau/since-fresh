/**
 * Pure rules for an item's history (its completion log). No I/O: service.ts
 * persists the result, reschedules notifications and records it for sync.
 *
 * History is stored newest first, by date. That's the order older builds
 * expect (they read history[0] as the latest), so it stays that way.
 * Dates are YYYY-MM-DD strings, which compare correctly as strings.
 */

import type { SinceItem, CompletionEvent } from '../../types';
import { addedDay, isDateItem } from './due.ts';

export type HistoryErrorCode = 'future' | 'out-of-range' | 'last-entry' | 'not-found';

export class HistoryError extends Error {
  readonly code: HistoryErrorCode;
  constructor(code: HistoryErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'HistoryError';
  }
}

/** Newest first; entries on the same day keep their current order. */
export function sortNewestFirst(history: CompletionEvent[]): CompletionEvent[] {
  return history
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? 1 : -1))
    .map(({ e }) => e);
}

/**
 * The one place that sets lastDoneDate: history sorted newest first, and
 * lastDoneDate set to the latest entry's date. Every history change goes
 * through here. A date item left with no entries goes back to "not done
 * yet": lastDoneDate is the day it was added again (due.ts).
 */
export function withHistory(item: SinceItem, history: CompletionEvent[], now: string): SinceItem {
  const sorted = sortNewestFirst(history);
  const empty = isDateItem(item) ? addedDay(item) : item.lastDoneDate;
  return {
    ...item,
    history: sorted,
    lastDoneDate: sorted.length > 0 ? sorted[0].date : empty,
    updatedAt: now,
  };
}

export function hasEntryOn(item: SinceItem, date: string): boolean {
  return item.history.some((e) => e.date === date);
}

export interface DateBounds {
  /** Earliest allowed date (the older neighbour's), or null for the oldest entry. */
  min: string | null;
  /** Latest allowed date: the newer neighbour's, or today for the newest entry. */
  max: string;
}

/** Where an entry's date may move to: between the entries either side of it, inclusive. */
export function dateBounds(item: SinceItem, entryId: string, today: string): DateBounds {
  const sorted = sortNewestFirst(item.history);
  const index = sorted.findIndex((e) => e.id === entryId);
  if (index === -1) throw new HistoryError('not-found', 'That entry no longer exists.');
  const newer = index > 0 ? sorted[index - 1] : null;
  const older = index < sorted.length - 1 ? sorted[index + 1] : null;
  return { min: older ? older.date : null, max: newer ? newer.date : today };
}

function checkNotFuture(date: string, today: string): void {
  if (date > today) throw new HistoryError('future', "That date hasn't happened yet.");
}

/** Add an entry on any past date (it takes its place in date order). */
export function addEntry(
  item: SinceItem,
  entry: { id: string; date: string; note?: string },
  today: string,
  now: string,
): SinceItem {
  checkNotFuture(entry.date, today);
  const note = entry.note?.trim();
  const added: CompletionEvent = { id: entry.id, date: entry.date, createdAt: now, ...(note ? { note } : {}) };
  return withHistory(item, [added, ...item.history], now);
}

/** Change an entry's date and/or note. The date must stay between its neighbours. */
export function updateEntry(
  item: SinceItem,
  entryId: string,
  changes: { date?: string; note?: string },
  today: string,
  now: string,
): SinceItem {
  const existing = item.history.find((e) => e.id === entryId);
  if (!existing) throw new HistoryError('not-found', 'That entry no longer exists.');

  if (changes.date !== undefined && changes.date !== existing.date) {
    checkNotFuture(changes.date, today);
    const { min, max } = dateBounds(item, entryId, today);
    if ((min !== null && changes.date < min) || changes.date > max) {
      throw new HistoryError('out-of-range', 'Pick a date between the entries either side of this one.');
    }
  }

  const updated: CompletionEvent = { ...existing };
  if (changes.date !== undefined) updated.date = changes.date;
  if (changes.note !== undefined) {
    const note = changes.note.trim();
    if (note) updated.note = note;
    else delete updated.note;
  }
  return withHistory(
    item,
    item.history.map((e) => (e.id === entryId ? updated : e)),
    now,
  );
}

/**
 * Remove an entry. Every item keeps at least one, except a date item ("until
 * it's due"), whose history may be empty.
 */
export function deleteEntry(item: SinceItem, entryId: string, now: string): SinceItem {
  if (!item.history.some((e) => e.id === entryId)) {
    throw new HistoryError('not-found', 'That entry no longer exists.');
  }
  if (item.history.length <= 1 && !isDateItem(item)) {
    throw new HistoryError('last-entry', 'Every item needs at least one entry. Delete the item instead.');
  }
  return withHistory(item, item.history.filter((e) => e.id !== entryId), now);
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/** Gap in days between each entry and the one before it, newest first. */
export function gapsNewestFirst(item: SinceItem): number[] {
  const sorted = sortNewestFirst(item.history);
  return sorted.slice(0, -1).map((e, i) => daysBetween(sorted[i + 1].date, e.date));
}

/** "Usually": the mean gap between entries, rounded. null with fewer than 2 gaps. */
export function usualIntervalDays(item: SinceItem): number | null {
  const gaps = gapsNewestFirst(item);
  if (gaps.length < 2) return null;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}
