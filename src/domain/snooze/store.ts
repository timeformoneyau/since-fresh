/**
 * Snoozes, kept on this phone only (rules.ts). A separate key from the list,
 * so items and their stored shape are untouched, and an older build simply
 * never reads it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSnoozes, serializeSnoozes, type Snoozes } from './rules';

export const SNOOZES_KEY = '@since_snoozes_v1';

export async function loadSnoozes(): Promise<Snoozes> {
  try {
    return parseSnoozes(await AsyncStorage.getItem(SNOOZES_KEY));
  } catch {
    return {};
  }
}

export async function saveSnoozes(snoozes: Snoozes): Promise<void> {
  await AsyncStorage.setItem(SNOOZES_KEY, serializeSnoozes(snoozes));
}
