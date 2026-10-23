/**
 * Public notification interface for Since.
 *
 * Screens import from here. What gets scheduled lives in plan.ts; engine.ts
 * hands it to the phone. This file also owns notification permissions and
 * Android channel setup.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SinceItem } from '../types';
import * as engine from './engine';
import { loadHouseholdState } from '../domain/household/store';
import { isMuted } from '../domain/household/rules';
import { loadSnoozes, saveSnoozes } from '../domain/snooze/store';
import { pruneSnoozes } from '../domain/snooze/rules';
import { loadReminderTime } from './reminderTimeStore';
import { readPermission, type PermissionState } from './permission';

/**
 * Reschedule every reminder for the list as it now stands.
 *
 * Shared items are reminded on every member's phone, except where that
 * member turned "Remind me about this" off (households), or someone else
 * looks after the item (plan.ts). Snoozed items wait
 * until their snooze ends. All go out at the chosen reminder time (9 am
 * unless changed). The daily cap applies to everything together.
 *
 * Snoozes that no longer apply (the item was marked done, its repeat changed,
 * it was deleted, or the snooze ended) are dropped here, so any change to the
 * list, from this phone or a sync, ends them.
 */
export async function rescheduleAllNotifications(items: SinceItem[]): Promise<void> {
  const state = await loadHouseholdState();
  const all = await loadSnoozes();
  const snoozes = pruneSnoozes(all, items, new Date());
  if (Object.keys(snoozes).length !== Object.keys(all).length) {
    await saveSnoozes(snoozes).catch(() => {});
  }
  await engine.rescheduleAllNotifications(items.filter((i) => !isMuted(i, state)), {
    snoozes,
    time: await loadReminderTime(),
    me: state.userId,
  });
}

/**
 * Cancel every scheduled notification on the device. Used when the local list
 * is removed (sign-out, account switch, account deletion).
 */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Set up the Android notification channel. Call once on app startup. It
 * doesn't ask for permission: that happens once, when a repeating item is
 * first saved (permissionFlow.ts).
 */
export async function setUpReminderChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Since reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/** Whether reminders can show, and whether Android will still show its prompt. */
export async function getReminderPermission(): Promise<PermissionState> {
  return readPermission(await Notifications.getPermissionsAsync());
}

/** Show the system prompt. Only from the explanation screen (permissionFlow.ts). */
export async function askForReminderPermission(): Promise<PermissionState> {
  return readPermission(await Notifications.requestPermissionsAsync());
}
