/**
 * Time of the last successful sync, kept on the phone for the Account screen
 * (F5). Cleared with the rest of the account's local data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_SYNCED_KEY = '@since_last_synced_v1';

export async function loadLastSyncedAt(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNCED_KEY);
}

export async function saveLastSyncedAt(iso: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNCED_KEY, iso);
}

export async function clearLastSyncedAt(): Promise<void> {
  await AsyncStorage.removeItem(LAST_SYNCED_KEY);
}
