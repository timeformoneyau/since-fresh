import AsyncStorage from '@react-native-async-storage/async-storage';
import { SinceItem } from '../../types';
import { parseAndMigrate, toEnvelope } from './migrations';

const STORAGE_KEY = '@since_v1_items';

export async function loadItems(): Promise<SinceItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parseAndMigrate(raw);
  } catch {
    return [];
  }
}

export async function saveItems(items: SinceItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, toEnvelope(items));
}
