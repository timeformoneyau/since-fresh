/**
 * "Until it's due": items tracked against a date the person sets (car rego
 * due 5 Dec, cancel a trial by 20 Jan) rather than "since I last did it".
 * Pure, so it runs under `npm test`.
 *
 * - An item with a dueDate is a date item. Its due date is that date, not
 *   last done + repeat.
 * - Its history starts empty: lastDoneDate then holds the day it was added
 *   (older builds need a string there), and lastDoneOf() says "not yet".
 * - Done on a repeating date item moves the due date on by the repeat from
 *   the previous due date, until it's in the future, so renewing early
 *   doesn't shift the cycle. Done on a one-off date item clears it, and the
 *   item becomes a once-off record.
 * - Items without a dueDate work exactly as before.
 */

import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';
import type { RepeatUnit, SinceItem } from '../../types';
import { comingUpThreshold, getNextDueDate, intervalToDays, parseDate } from '../../utils/dateUtils.ts';

/** A real calendar date written YYYY-MM-DD. */
export function isDueDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Tracked "until it's due". */
export function isDateItem(item: Pick<SinceItem, 'dueDate'>): boolean {
  return typeof item.dueDate === 'string';
}

/** The last time it was done, or null for a date item not done yet. */
export function lastDoneOf(item: Pick<SinceItem, 'lastDoneDate' | 'history'>): string | null {
  return item.history.length > 0 ? item.lastDoneDate : null;
}

/** The day an item was added, as a local YYYY-MM-DD date. */
export function addedDay(item: Pick<SinceItem, 'createdAt' | 'lastDoneDate'>): string {
  const created = new Date(item.createdAt);
  return Number.isNaN(created.getTime()) ? item.lastDoneDate : format(created, 'yyyy-MM-dd');
}

/** When it's next due: its dueDate, else last done + repeat. null for a once-off record. */
export function nextDueOf(item: SinceItem): Date | null {
  if (typeof item.dueDate === 'string') return parseDate(item.dueDate);
  if (item.repeatValue === null || item.repeatUnit === null) return null;
  return getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
}

/** Whether it has a due date at all, so it can be due, reminded and marked done. */
export function hasDue(item: SinceItem): boolean {
  return nextDueOf(item) !== null;
}

/** Date items always get at least this much notice ("coming up"). */
export const DATE_ITEM_MIN_NOTICE_DAYS = 7;

/**
 * Days before the due date that "coming up" starts, for both the status and
 * the reminder. Since items: by interval, as before (1 to 45 days). Date
 * items: the same, but never under a week. A one-off date item's interval is
 * the time from when it was added (or last done) to its due date.
 */
export function comingUpDays(item: SinceItem): number | null {
  const due = nextDueOf(item);
  if (!due) return null;
  if (typeof item.dueDate !== 'string') {
    return comingUpThreshold(intervalToDays(item.repeatValue!, item.repeatUnit!));
  }
  const interval =
    item.repeatValue !== null && item.repeatUnit !== null
      ? intervalToDays(item.repeatValue, item.repeatUnit)
      : Math.round((due.getTime() - parseDate(item.lastDoneDate).getTime()) / 86_400_000);
  return Math.max(DATE_ITEM_MIN_NOTICE_DAYS, comingUpThreshold(interval));
}

function addInterval(date: Date, n: number, unit: RepeatUnit): Date {
  switch (unit) {
    case 'days': return addDays(date, n);
    case 'weeks': return addWeeks(date, n);
    case 'months': return addMonths(date, n);
    case 'years': return addYears(date, n);
  }
}

/**
 * The next due date after Done on `today`: the previous due date plus the
 * repeat, as many times as it takes to be after today (at least once).
 * Counted from the previous due date each time, so 31 Jan monthly goes to
 * 28 Feb, then 31 Mar, never drifting.
 */
export function rollForward(dueDate: string, value: number, unit: RepeatUnit, today: string): string {
  const base = parseDate(dueDate);
  const day = parseDate(today);
  for (let k = 1; ; k++) {
    const next = addInterval(base, k * value, unit);
    if (next > day) return format(next, 'yyyy-MM-dd');
  }
}

/**
 * A date item's dueDate after Done on `today`: moved on when it repeats,
 * cleared (null) when it's one-off.
 */
export function dueDateAfterDone(item: SinceItem, today: string): string | null {
  if (typeof item.dueDate !== 'string') return item.dueDate ?? null;
  if (item.repeatValue === null || item.repeatUnit === null) return null;
  return rollForward(item.dueDate, item.repeatValue, item.repeatUnit, today);
}

/** "In 1 month", "In 3 months", "In 1 year": the quick choices for a due date. */
export const DUE_QUICK_PICKS: Array<{ id: string; label: string; value: number; unit: RepeatUnit }> = [
  { id: '1-month', label: 'In 1 month', value: 1, unit: 'months' },
  { id: '3-months', label: 'In 3 months', value: 3, unit: 'months' },
  { id: '1-year', label: 'In 1 year', value: 1, unit: 'years' },
];

/** The date a quick choice stands for, from today. */
export function quickPickDate(value: number, unit: RepeatUnit, today: string): string {
  return format(addInterval(parseDate(today), value, unit), 'yyyy-MM-dd');
}
