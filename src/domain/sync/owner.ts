/**
 * Which account the local list belongs to. See ownership.ts for the rules.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const OWNER_KEY = '@since_owner_v1';

export async function loadOwner(): Promise<string | null> {
  return AsyncStorage.getItem(OWNER_KEY);
}

export async function saveOwner(userId: string): Promise<void> {
  await AsyncStorage.setItem(OWNER_KEY, userId);
}

export async function clearOwner(): Promise<void> {
  await AsyncStorage.removeItem(OWNER_KEY);
}
