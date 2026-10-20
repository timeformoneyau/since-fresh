/* global jest */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Local-only mode: no Supabase credentials, so no sign-in gate and sync no-ops.
// This is how the app runs on a phone with no cloud config.
jest.mock('./src/lib/supabase', () => ({
  isCloudSyncConfigured: () => false,
  getSupabase: () => null,
  requireSupabase: () => {
    throw new Error('Cloud sync is not configured.');
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// Renders children with fixed insets (the real provider waits for native layout)
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

// The native UUID generator isn't available under Jest; use Node's
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('crypto').randomUUID(),
}));

// Backup files (Account → Backup file). Native modules, so tests get stand-ins:
// writes are kept in memory and the picker returns whatever a test sets.
jest.mock('expo-file-system', () => {
  const files = new Map();
  class File {
    constructor(...parts) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() { files.set(this.uri, ''); }
    write(text) { files.set(this.uri, text); }
    async text() { return files.get(this.uri) ?? ''; }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } }, __files: files };
});
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));
