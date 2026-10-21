/**
 * What to schedule, and when. Pure (no expo-notifications), so it runs under
 * `npm test`; engine.ts hands the result to the phone.
 *
 * Design philosophy: "a quiet, reliable system that only speaks up when it matters."
 *
 *   Per-item notifications (3 per repeat item):
 *     1. Coming up   — interval-aware advance notice (e.g. 7 days before for a monthly item)
 *     2. Due today   — fires on the nextDueDate
 *     3. 7 days overdue — a single early overdue nudge
 *
 *   Grouped notifications (for long-neglected items):
 *     - Items 21+ days overdue graduate from individual to grouped reminders
 *     - One grouped notification fires every 14 days from the 21-day mark
 *     - The message reflects how many items are overdue at that point
 *     - Max 1 grouped notification per calendar day
 *
 *   Snoozed items ("Not yet", snooze/rules.ts):
 *     - Send nothing up to and including the day the snooze ends, and aren't
 *       counted in grouped notices on those days, so they take no part in the cap
 *     - On the day it ends: one normal reminder at the usual time
 *     - After that the usual schedule carries on (7-day overdue, grouped)
 *
 *   Daily cap:
 *     - No more than MAX_PER_DAY notifications on any single calendar day
 *     - When multiple notifications compete for a day, higher priority wins
 *     - Priority order: grouped overdue > 7-day overdue / snooze ended > due today > coming up
 *
 * Identifier scheme (enables safe cancellation and deduplication):
 *   since_{itemId}_coming_up
 *   since_{itemId}_due
 *   since_{itemId}_overdue_7
 *   since_{itemId}_snooze_end
 *   since_grouped_{YYYY-MM-DD}
 */

import { differenceInCalendarDays, addDays, format, startOfDay } from 'date-fns';
import type { SinceItem } from '../types';
import {
  getNextDueDate,
  intervalToDays,
  comingUpThreshold,
  parseDate,
} from '../utils/dateUtils.ts';
import { activeSnoozeUntil, type Snoozes } from '../domain/snooze/rules.ts';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Max notifications on any single calendar day. Keeps the system quiet. */
export const MAX_PER_DAY = 2;

/** Days overdue before an item switches from individual to grouped notifications. */
const GROUPED_THRESHOLD_DAYS = 21;

/** Interval (days) between grouped overdue reminders. */
const GROUPED_INTERVAL_DAYS = 14;

/** How many future grouped slots to pre-schedule per qualifying item. */
const GROUPED_LOOKAHEAD = 4;

/** All notification identifiers use this prefix for bulk cancellation. */
export const ID_PREFIX = 'since_';

/** Time of day reminders go out. */
export interface ReminderTime {
  hour: number;   // 0–23
  minute: number; // 0–59
}

export const DEFAULT_REMINDER_TIME: ReminderTime = { hour: 9, minute: 0 };

// ─── Priority ─────────────────────────────────────────────────────────────────
// Lower number = higher priority. Used to resolve conflicts when multiple
// notifications compete for the same calendar day.

export const PRIORITY = {
  GROUPED_OVERDUE: 0, // Multiple things need attention — highest signal
  OVERDUE_7:       1, // One item has been overdue a week, or its snooze ended
  DUE_TODAY:       2, // Something is due right now
  COMING_UP:       3, // Advance notice — lowest priority
} as const;

type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export interface PlannedNotification {
  identifier: string;
  body: string;
  triggerDate: Date;
  priority: Priority;
}

export interface PlanOptions {
  now: Date;
  time?: ReminderTime;
  snoozes?: Snoozes;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function atTime(date: Date, time: ReminderTime): Date {
  const d = new Date(date);
  d.setHours(time.hour, time.minute, 0, 0);
  return d;
}

function calendarDayKey(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

const dayLabel = (n: number) => `${n} day${n !== 1 ? 's' : ''}`;

/** The day a snooze ends, if this item is snoozed. */
function snoozeEnd(item: SinceItem, opts: PlanOptions): Date | null {
  const until = activeSnoozeUntil(item, opts.snoozes, opts.now);
  return until ? parseDate(until) : null;
}

/** Quiet up to and including the day the snooze ends. */
function silencedOn(date: Date, end: Date | null): boolean {
  return end !== null && differenceInCalendarDays(date, end) <= 0;
}

// ─── Daily cap ────────────────────────────────────────────────────────────────

/**
 * For each calendar day, keeps the highest-priority notifications up to
 * MAX_PER_DAY and drops the rest. Past triggers are dropped too.
 *
 * This means if a day has both a "coming up" and a "7 days overdue" notification,
 * the overdue one wins. The coming-up is quietly dropped.
 */
export function applyDailyCap(pending: PlannedNotification[], now: Date): PlannedNotification[] {
  const byDay = new Map<string, PlannedNotification[]>();
  for (const n of pending) {
    if (n.triggerDate <= now) continue;
    const key = calendarDayKey(n.triggerDate);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(n);
  }

  const kept: PlannedNotification[] = [];
  for (const dayNotifs of byDay.values()) {
    dayNotifs.sort((a, b) => a.priority - b.priority);
    kept.push(...dayNotifs.slice(0, MAX_PER_DAY));
  }
  return kept.sort((a, b) => a.triggerDate.getTime() - b.triggerDate.getTime());
}

// ─── Per-item notification builder ────────────────────────────────────────────

/**
 * Computes the lifecycle notifications for one repeat item.
 * Returns empty array for non-repeating items (nothing to schedule).
 *
 * Notification language deliberately avoids appointment-style phrasing.
 * e.g. "Dentist due in 7 days" not "Dentist coming up in 7 days".
 */
function buildItemNotifications(item: SinceItem, opts: PlanOptions): PlannedNotification[] {
  if (!item.repeatValue || !item.repeatUnit) return [];
  const time = opts.time ?? DEFAULT_REMINDER_TIME;

  const nextDue = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
  const approxInterval = intervalToDays(item.repeatValue, item.repeatUnit);
  const threshold = comingUpThreshold(approxInterval);
  const end = snoozeEnd(item, opts);

  const all: PlannedNotification[] = [
    {
      identifier: `${ID_PREFIX}${item.id}_coming_up`,
      body: `${item.name} due in ${dayLabel(threshold)}`,
      triggerDate: atTime(addDays(nextDue, -threshold), time),
      priority: PRIORITY.COMING_UP,
    },
    {
      identifier: `${ID_PREFIX}${item.id}_due`,
      body: `${item.name} due today`,
      triggerDate: atTime(nextDue, time),
      priority: PRIORITY.DUE_TODAY,
    },
    {
      identifier: `${ID_PREFIX}${item.id}_overdue_7`,
      body: `${item.name} overdue by ${dayLabel(7)}`,
      triggerDate: atTime(addDays(nextDue, 7), time),
      priority: PRIORITY.OVERDUE_7,
    },
  ];
  if (!end) return all;

  // Snoozed: nothing until it ends, then one normal reminder that day
  const overdueBy = differenceInCalendarDays(end, nextDue);
  return [
    ...all.filter((n) => !silencedOn(n.triggerDate, end)),
    {
      identifier: `${ID_PREFIX}${item.id}_snooze_end`,
      body: overdueBy > 0 ? `${item.name} overdue by ${dayLabel(overdueBy)}` : `${item.name} due today`,
      triggerDate: atTime(end, time),
      priority: PRIORITY.OVERDUE_7,
    },
  ];
}

// ─── Grouped overdue notification builder ─────────────────────────────────────

/**
 * Builds grouped "attention" notifications for items that will be 21+ days overdue.
 *
 * Rationale: once an item has been ignored for 3 weeks, sending individual
 * notifications per item creates noise. Instead, we batch all qualifying items
 * into one notification per day, fired every 14 days.
 *
 * For each item that will be 21+ days overdue, we compute the dates at which
 * grouped notifications should fire (21d, 35d, 49d, 63d overdue). We collect
 * all such dates across all items, deduplicate by calendar day, and for each
 * unique day compute how many items will be qualifying-overdue on that day.
 * A snoozed item counts only after its snooze has ended.
 */
function buildGroupedNotifications(items: SinceItem[], opts: PlanOptions): PlannedNotification[] {
  const { now } = opts;
  const time = opts.time ?? DEFAULT_REMINDER_TIME;
  const seenDays = new Set<string>();
  const results: PlannedNotification[] = [];

  const repeating = items.flatMap((item) =>
    item.repeatValue && item.repeatUnit
      ? [{ nextDue: getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit), end: snoozeEnd(item, opts) }]
      : [],
  );

  // Collect all candidate fire dates from all qualifying items
  const candidateDates: Date[] = [];
  for (const { nextDue, end } of repeating) {
    const groupedStart = addDays(nextDue, GROUPED_THRESHOLD_DAYS);
    for (let i = 0; i < GROUPED_LOOKAHEAD; i++) {
      const fireDate = atTime(addDays(groupedStart, i * GROUPED_INTERVAL_DAYS), time);
      if (fireDate > now && !silencedOn(fireDate, end)) candidateDates.push(fireDate);
    }
  }

  // Process dates nearest-first so earlier notifications get preference on shared days
  candidateDates.sort((a, b) => a.getTime() - b.getTime());

  for (const date of candidateDates) {
    const dayKey = calendarDayKey(date);
    if (seenDays.has(dayKey)) continue; // enforce 1 grouped notification per day
    seenDays.add(dayKey);

    // Count items that will be 21+ days overdue (and not snoozed) on this date
    const overdueCount = repeating.filter(
      ({ nextDue, end }) =>
        differenceInCalendarDays(date, nextDue) >= GROUPED_THRESHOLD_DAYS && !silencedOn(date, end),
    ).length;

    if (overdueCount === 0) continue;

    const body =
      overdueCount === 1
        ? 'Something might need your attention'
        : overdueCount === 2
        ? 'A couple of things might need attention'
        : `${overdueCount} things might need attention`;

    results.push({
      identifier: `${ID_PREFIX}grouped_${dayKey}`,
      body,
      triggerDate: date,
      priority: PRIORITY.GROUPED_OVERDUE,
    });
  }

  return results;
}

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Everything that should be scheduled for these items: per-item lifecycle
 * notifications, grouped overdue notices, the daily cap across the lot.
 */
export function planNotifications(items: SinceItem[], opts: PlanOptions): PlannedNotification[] {
  const all = items.flatMap((item) => buildItemNotifications(item, opts));
  all.push(...buildGroupedNotifications(items, opts));
  return applyDailyCap(all, opts.now);
}
