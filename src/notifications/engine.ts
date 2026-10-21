/**
 * Notification Engine for Since: hands the plan (plan.ts) to the phone.
 *
 * What gets scheduled and when (lifecycle reminders, grouped overdue
 * notices, snoozes, the daily cap) is worked out in plan.ts, which is pure
 * and tested. This module only cancels and schedules.
 */

import * as Notifications from 'expo-notifications';
import { SinceItem } from '../types';
import { planNotifications, ID_PREFIX, type PlanOptions, type PlannedNotification } from './plan';

async function commitNotifications(toSchedule: PlannedNotification[]): Promise<void> {
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

/**
 * Full recompute for all items: cancels every Since notification, then
 * schedules the plan, with the daily cap applied across the whole set.
 *
 * Call after any change. A one-item reschedule can't keep the cap or the
 * grouped counts right, so there isn't one.
 */
export async function rescheduleAllNotifications(
  items: SinceItem[],
  opts: Omit<PlanOptions, 'now'> = {},
): Promise<void> {
  await cancelByPrefix(ID_PREFIX);
  await commitNotifications(planNotifications(items, { ...opts, now: new Date() }));
}
