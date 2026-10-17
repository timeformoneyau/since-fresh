/**
 * Public notification interface for Since.
 *
 * Screens import from here. The actual scheduling logic lives in engine.ts.
 * This file also owns notification permissions and Android channel setup.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SinceItem } from '../types';

export {
  scheduleItemNotifications,
  cancelItemNotifications,
  rescheduleAllNotifications,
} from './engine';

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
