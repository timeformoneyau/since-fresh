/**
 * Public notification interface for Since.
 *
 * Screens import from here. The actual scheduling logic lives in engine.ts.
 * This file also owns notification permissions and Android channel setup.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SinceItem } from '../types';
import * as engine from './engine';
import { loadHouseholdState } from '../domain/household/store';
import { isMuted } from '../domain/household/rules';

export { cancelItemNotifications } from './engine';

/**
 * Shared items are reminded on every member's phone, except where that
 * member turned "Remind me about this" off (households). The daily cap
 * applies to personal and shared items together.
 */
export async function rescheduleAllNotifications(items: SinceItem[]): Promise<void> {
  const state = await loadHouseholdState();
  await engine.rescheduleAllNotifications(items.filter((i) => !isMuted(i, state)));
}

export async function scheduleItemNotifications(item: SinceItem): Promise<void> {
  if (isMuted(item, await loadHouseholdState())) {
    await engine.cancelItemNotifications(item.id);
    return;
  }
  await engine.scheduleItemNotifications(item);
}

/**
 * Cancel every scheduled notification on the device. Used when the local list
 * is removed (sign-out, account switch, account deletion).
 */
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Request notification permissions and set up the Android notification channel.
 * Call once on app startup.
 */
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
