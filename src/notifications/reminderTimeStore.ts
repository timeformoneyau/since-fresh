/** The reminder time (reminderTime.ts), on this phone only. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseReminderTime, serializeReminderTime, type ReminderTime } from './reminderTime';

export const REMINDER_TIME_KEY = '@since_reminder_time_v1';

export async function loadReminderTime(): Promise<ReminderTime> {
  try {
    return parseReminderTime(await AsyncStorage.getItem(REMINDER_TIME_KEY));
  } catch {
    return parseReminderTime(null);
  }
}

export async function saveReminderTime(time: ReminderTime): Promise<void> {
  await AsyncStorage.setItem(REMINDER_TIME_KEY, serializeReminderTime(time));
}
