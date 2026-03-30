import AsyncStorage from '@react-native-async-storage/async-storage';
import { SinceItem } from '../types';

const STORAGE_KEY = '@since_v1_items';

export async function loadItems(): Promise<SinceItem[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (!json) return [];
    return JSON.parse(json) as SinceItem[];
  } catch {
    return [];
  }
}

export async function saveItems(items: SinceItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function addItem(item: SinceItem): Promise<void> {
  const items = await loadItems();
  await saveItems([...items, item]);
}

export async function updateItem(updated: SinceItem): Promise<void> {
  const items = await loadItems();
  await saveItems(items.map((i) => (i.id === updated.id ? updated : i)));
}

export async function deleteItem(id: string): Promise<void> {
  const items = await loadItems();
  await saveItems(items.filter((i) => i.id !== id));
}
