import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SinceItem } from '../types';
import { getNextDueDate, intervalToDays, comingUpThreshold } from '../utils/dateUtils';
import { addDays } from 'date-fns';

const PREFIX = 'since_';

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Since reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function cancelItemNotifications(itemId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter((n) =>
    n.identifier.startsWith(`${PREFIX}${itemId}_`),
  );
  await Promise.all(
    toCancel.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier),
    ),
  );
}

/**
 * Schedule up to 3 notifications per item:
 *   1. Coming up (N days before due)
 *   2. Due today
 *   3. 7 days overdue
 *
 * TODO: Add grouped reminders every 14 days for items 21+ days overdue.
 */
export async function scheduleItemNotifications(item: SinceItem): Promise<void> {
  if (!item.repeatValue || !item.repeatUnit) return;

  await cancelItemNotifications(item.id);

  const now = new Date();
  const nextDue = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
  const approxInterval = intervalToDays(item.repeatValue, item.repeatUnit);
  const threshold = comingUpThreshold(approxInterval);

  const at9am = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  const schedule = async (suffix: string, body: string, triggerDate: Date) => {
    if (triggerDate <= now) return;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${item.id}_${suffix}`,
        content: { title: 'Since', body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
      });
    } catch {
      // Notification scheduling is non-critical — silently skip on error
    }
  };


  await schedule(
    'coming_up',
    `${item.name} due in ${threshold} day${threshold !== 1 ? 's' : ''}`,
    at9am(addDays(nextDue, -threshold)),
  );

  await schedule('due', `${item.name} due today`, at9am(nextDue));

  await schedule('overdue_7', `${item.name} overdue by 7 days`, at9am(addDays(nextDue, 7)));
}

export async function rescheduleAllItems(items: SinceItem[]): Promise<void> {
  for (const item of items) {
    await scheduleItemNotifications(item);
  }
}
