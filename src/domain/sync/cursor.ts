/**
 * How far this phone has pulled (runSync.ts): the server change times of the
 * latest item and entry seen. Kept per account, so a cursor never carries
 * over to another account; cleared with the rest of the account's local data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SyncCursor } from './runSync';

const CURSOR_KEY = '@since_sync_cursor_v1';

interface StoredCursor extends SyncCursor {
  userId: string;
}

export async function loadCursor(userId: string): Promise<SyncCursor | null> {
  try {
    const raw = await AsyncStorage.getItem(CURSOR_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredCursor>;
    if (stored.userId !== userId) return null;
    const time = (v: unknown) => (typeof v === 'string' ? v : null);
    return { items: time(stored.items), entries: time(stored.entries) };
  } catch {
    // Unreadable: start again with a full pull, which is always safe.
    return null;
  }
}

export async function saveCursor(userId: string, cursor: SyncCursor): Promise<void> {
  const stored: StoredCursor = { userId, ...cursor };
  await AsyncStorage.setItem(CURSOR_KEY, JSON.stringify(stored));
}

export async function clearCursor(): Promise<void> {
  await AsyncStorage.removeItem(CURSOR_KEY);
}
