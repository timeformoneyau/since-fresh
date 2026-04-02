/**
 * Notification Engine for Since
 *
 * Design philosophy: "a quiet, reliable system that only speaks up when it matters."
 *
 * This engine manages the full lifecycle of notifications for Since items:
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
 *   Daily cap:
 *     - No more than MAX_PER_DAY notifications on any single calendar day
 *     - When multiple notifications compete for a day, higher priority wins
 *     - Priority order: grouped overdue > 7-day overdue > due today > coming up
 *
 * Identifier scheme (enables safe cancellation and deduplication):
 *   since_{itemId}_coming_up
 *   since_{itemId}_due
 *   since_{itemId}_overdue_7
 *   since_grouped_{YYYY-MM-DD}
 */

import * as Notifications from 'expo-notifications';
import { differenceInCalendarDays, addDays, format, startOfDay } from 'date-fns';
import { SinceItem } from '../types';
import {
  getNextDueDate,
  intervalToDays,
  comingUpThreshold,
} from '../utils/dateUtils';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Max notifications on any single calendar day. Keeps the system quiet. */
const MAX_PER_DAY = 2;

/** Days overdue before an item switches from individual to grouped notifications. */
const GROUPED_THRESHOLD_DAYS = 21;

/** Interval (days) between grouped overdue reminders. */
const GROUPED_INTERVAL_DAYS = 14;

/** How many future grouped slots to pre-schedule per qualifying item. */
const GROUPED_LOOKAHEAD = 4;

/** All notification identifiers use this prefix for bulk cancellation. */
const ID_PREFIX = 'since_';

// ─── Priority ─────────────────────────────────────────────────────────────────
// Lower number = higher priority. Used to resolve conflicts when multiple
// notifications compete for the same calendar day.

const PRIORITY = {
  GROUPED_OVERDUE: 0, // Multiple things need attention — highest signal
  OVERDUE_7:       1, // One item has been overdue a week
  DUE_TODAY:       2, // Something is due right now
  COMING_UP:       3, // Advance notice — lowest priority
} as const;

type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

// ─── Internal types ───────────────────────────────────────────────────────────

interface PendingNotification {
  identifier: string;
  body: string;
  triggerDate: Date;
  priority: Priority;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function at9am(date: Date): Date {
  const d = new Date(date);
  d.setHours(9, 0, 0, 0);
  return d;
}

function calendarDayKey(date: Date): string {
  return format(startOfDay(date), 'yyyy-MM-dd');
}

// ─── Scheduling commit ────────────────────────────────────────────────────────

/**
 * Takes a list of candidate notifications and schedules them, applying the daily cap.
 *
 * For each calendar day:
 *   - Sort candidates by priority (ascending = most important first)
 *   - Keep only the top MAX_PER_DAY
 *   - Schedule those; silently drop the rest
 *
 * This means if a day has both a "coming up" and a "7 days overdue" notification,
 * the overdue one wins. The coming-up is quietly dropped.
 */
async function commitNotifications(pending: PendingNotification[]): Promise<void> {
  const now = new Date();

  // Group future-dated notifications by calendar day
  const byDay = new Map<string, PendingNotification[]>();
  for (const n of pending) {
    if (n.triggerDate <= now) continue; // skip already-past triggers
    const key = calendarDayKey(n.triggerDate);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(n);
  }

  // Within each day, keep highest-priority notifications up to the cap
  const toSchedule: PendingNotification[] = [];
  for (const dayNotifs of byDay.values()) {
    dayNotifs.sort((a, b) => a.priority - b.priority);
    toSchedule.push(...dayNotifs.slice(0, MAX_PER_DAY));
  }

  for (const n of toSchedule) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: n.identifier,
        content: { title: 'Since', body: n.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: n.triggerDate,
        },
      });
    } catch {
      // Scheduling is non-critical. Silently skip on permission or platform errors.
    }
  }
}

// ─── Per-item notification builder ────────────────────────────────────────────

/**
 * Computes the 3 lifecycle notifications for one repeat item.
 * Returns empty array for non-repeating items (nothing to schedule).
 *
 * Notification language deliberately avoids appointment-style phrasing.
 * e.g. "Dentist due in 7 days" not "Dentist coming up in 7 days".
 */
function buildItemNotifications(item: SinceItem): PendingNotification[] {
  if (!item.repeatValue || !item.repeatUnit) return [];

  const nextDue = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
  const approxInterval = intervalToDays(item.repeatValue, item.repeatUnit);
  const threshold = comingUpThreshold(approxInterval);
  const dayLabel = (n: number) => `${n} day${n !== 1 ? 's' : ''}`;

  return [
    {
      identifier: `${ID_PREFIX}${item.id}_coming_up`,
      body: `${item.name} due in ${dayLabel(threshold)}`,
      triggerDate: at9am(addDays(nextDue, -threshold)),
      priority: PRIORITY.COMING_UP,
    },
    {
      identifier: `${ID_PREFIX}${item.id}_due`,
      body: `${item.name} due today`,
      triggerDate: at9am(nextDue),
      priority: PRIORITY.DUE_TODAY,
    },
    {
      identifier: `${ID_PREFIX}${item.id}_overdue_7`,
      body: `${item.name} overdue by ${dayLabel(7)}`,
      triggerDate: at9am(addDays(nextDue, 7)),
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
 */
function buildGroupedNotifications(items: SinceItem[]): PendingNotification[] {
  const now = new Date();
  const seenDays = new Set<string>();
  const results: PendingNotification[] = [];

  // Collect all candidate fire dates from all qualifying items
  const candidateDates: Date[] = [];
  for (const item of items) {
    if (!item.repeatValue || !item.repeatUnit) continue;

    const nextDue = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
    const groupedStart = addDays(nextDue, GROUPED_THRESHOLD_DAYS);

    for (let i = 0; i < GROUPED_LOOKAHEAD; i++) {
      const fireDate = at9am(addDays(groupedStart, i * GROUPED_INTERVAL_DAYS));
      if (fireDate > now) {
        candidateDates.push(fireDate);
      }
    }
  }

  // Process dates nearest-first so earlier notifications get preference on shared days
  candidateDates.sort((a, b) => a.getTime() - b.getTime());

  for (const date of candidateDates) {
    const dayKey = calendarDayKey(date);
    if (seenDays.has(dayKey)) continue; // enforce 1 grouped notification per day
    seenDays.add(dayKey);

    // Count items that will be 21+ days overdue on this date
    let overdueCount = 0;
    for (const item of items) {
      if (!item.repeatValue || !item.repeatUnit) continue;
      const nextDue = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
      const daysOverdue = differenceInCalendarDays(date, nextDue);
      if (daysOverdue >= GROUPED_THRESHOLD_DAYS) overdueCount++;
    }

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

// ─── Cancellation helpers ─────────────────────────────────────────────────────

async function cancelByPrefix(prefix: string): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(prefix))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // Non-critical
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Schedule lifecycle notifications for a single item.
 * Cancels existing notifications for this item before rescheduling.
 *
 * Call when: item is created, edited, or marked as done.
 *
 * Note: this does not recompute grouped notifications. If grouped accuracy
 * matters (e.g. after delete), call rescheduleAllNotifications instead.
 */
export async function scheduleItemNotifications(item: SinceItem): Promise<void> {
  await cancelItemNotifications(item.id);
  await commitNotifications(buildItemNotifications(item));
}

/**
 * Cancel all scheduled notifications for a specific item.
 * Call when: item is deleted.
 */
export async function cancelItemNotifications(itemId: string): Promise<void> {
  await cancelByPrefix(`${ID_PREFIX}${itemId}_`);
}

/**
 * Full recompute for all items.
 *
 * Cancels every Since notification, then rebuilds:
 *   - Per-item lifecycle notifications for all repeat items
 *   - Grouped overdue notifications across all qualifying items
 *   - Applies the daily cap across the combined set
 *
 * Call when: app starts, or after any change that affects multiple items.
 * This is the most accurate call and should be preferred when the full
 * item list is available.
 */
export async function rescheduleAllNotifications(items: SinceItem[]): Promise<void> {
  // Cancel all Since notifications in a single pass
  await cancelByPrefix(ID_PREFIX);

  // Build the full set of desired notifications
  const all: PendingNotification[] = [];
  for (const item of items) {
    all.push(...buildItemNotifications(item));
  }
  all.push(...buildGroupedNotifications(items));

  // Commit with daily cap applied across the full set
  await commitNotifications(all);
}
