/**
 * Snooze ("Not yet"): quiets one item's reminders for a while. Pure, so it
 * runs under `npm test`; store.ts keeps it on the phone.
 *
 * - Offered on items that are due or overdue: 3 days, 1 week or 1 month.
 * - Only reminders change. The due date, history and status stay true.
 * - Personal and on this phone only: on a shared item it quiets this phone's
 *   reminders and nobody else's. It doesn't follow you to a second phone.
 * - A snooze holds only while the item is as it was when snoozed: marking it
 *   done (here or on another phone), changing its repeat or its due date
 *   (date items) ends it, and a
 *   deleted item takes its snooze with it (pruneSnoozes).
 */

import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import type { RepeatUnit, SinceItem } from '../../types';
import { parseDate } from '../../utils/dateUtils.ts';
import { nextDueOf } from '../items/due.ts';

export type SnoozeOption = '3-days' | '1-week' | '1-month';

export const SNOOZE_OPTIONS: { key: SnoozeOption; label: string }[] = [
  { key: '3-days', label: '3 days' },
  { key: '1-week', label: '1 week' },
  { key: '1-month', label: '1 month' },
];

export interface Snooze {
  /** YYYY-MM-DD: the day reminders start again. */
  until: string;
  /** The item as it was when snoozed; a change to any of these ends it. */
  lastDoneDate: string;
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  /**
   * A date item's due date when snoozed; absent for other items, and in
   * snoozes saved before date items. A change to it ends the snooze.
   */
  dueDate?: string;
}

/** By item id. */
export type Snoozes = Record<string, Snooze>;

/** Storage format version (store.ts). Later versions may add fields only. */
export const SNOOZES_VERSION = 1;

/** Due today or overdue: the only time "Not yet" is offered. */
export function canSnooze(item: SinceItem, now: Date): boolean {
  const due = nextDueOf(item);
  return due !== null && differenceInCalendarDays(due, startOfDay(now)) <= 0;
}

export function snoozeUntil(option: SnoozeOption, now: Date): string {
  const today = startOfDay(now);
  const until =
    option === '3-days' ? addDays(today, 3) : option === '1-week' ? addWeeks(today, 1) : addMonths(today, 1);
  return format(until, 'yyyy-MM-dd');
}

export function makeSnooze(item: SinceItem, option: SnoozeOption, now: Date): Snooze {
  return {
    until: snoozeUntil(option, now),
    lastDoneDate: item.lastDoneDate,
    repeatValue: item.repeatValue,
    repeatUnit: item.repeatUnit,
    ...(typeof item.dueDate === 'string' ? { dueDate: item.dueDate } : {}),
  };
}

function stillApplies(item: SinceItem, s: Snooze): boolean {
  return (
    s.lastDoneDate === item.lastDoneDate &&
    s.repeatValue === item.repeatValue &&
    s.repeatUnit === item.repeatUnit &&
    (s.dueDate ?? null) === (item.dueDate ?? null)
  );
}

/**
 * The day this item's snooze ends, while it is snoozed (up to and including
 * that day), or null.
 */
export function activeSnoozeUntil(item: SinceItem, snoozes: Snoozes | undefined, now: Date): string | null {
  const s = snoozes?.[item.id];
  if (!s || !stillApplies(item, s)) return null;
  return differenceInCalendarDays(parseDate(s.until), startOfDay(now)) >= 0 ? s.until : null;
}

/** Only the snoozes still doing something: known items, unchanged, not ended. */
export function pruneSnoozes(snoozes: Snoozes, items: SinceItem[], now: Date): Snoozes {
  const kept: Snoozes = {};
  for (const item of items) {
    if (activeSnoozeUntil(item, snoozes, now)) kept[item.id] = snoozes[item.id];
  }
  return kept;
}

/** "Snoozed until Tuesday", or null when there's nothing to say. */
export function snoozeNote(until: string | null | undefined, now: Date): string | null {
  if (!until) return null;
  const date = parseDate(until);
  const days = differenceInCalendarDays(date, startOfDay(now));
  if (days <= 0) return null;
  if (days === 1) return 'Snoozed until tomorrow';
  if (days < 7) return `Snoozed until ${format(date, 'EEEE')}`;
  return `Snoozed until ${format(date, 'd MMM')}`;
}

function isSnooze(s: unknown): s is Snooze {
  if (!s || typeof s !== 'object') return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.until === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.until) &&
    typeof v.lastDoneDate === 'string' &&
    (v.repeatValue === null || typeof v.repeatValue === 'number') &&
    (v.repeatUnit === null || typeof v.repeatUnit === 'string') &&
    (v.dueDate === undefined || typeof v.dueDate === 'string')
  );
}

/**
 * Read what store.ts saved. Missing or unreadable data is no snoozes (only
 * reminders are affected, never items). Entries this build doesn't
 * understand are skipped; extra fields from a newer build are kept.
 */
export function parseSnoozes(raw: string | null): Snoozes {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as { snoozes?: unknown };
    if (!data || typeof data.snoozes !== 'object' || data.snoozes === null) return {};
    const out: Snoozes = {};
    for (const [id, s] of Object.entries(data.snoozes as Record<string, unknown>)) {
      if (isSnooze(s)) out[id] = s;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeSnoozes(snoozes: Snoozes): string {
  return JSON.stringify({ version: SNOOZES_VERSION, snoozes });
}
