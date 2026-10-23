/**
 * Whether the reminders explanation was answered and the "Reminders are off"
 * notice dismissed. This phone only (not synced, not in the backup file),
 * like the reminder time. Missing or unreadable means "not yet".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { readPrefs, type ReminderPromptPrefs } from './permission';

const KEY = '@since_reminder_prompt_v1';

export async function loadPromptPrefs(): Promise<ReminderPromptPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? readPrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export async function updatePromptPrefs(change: ReminderPromptPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...(await loadPromptPrefs()), ...change }));
  } catch {
    // Best effort: at worst the explanation or notice shows once more
  }
}
