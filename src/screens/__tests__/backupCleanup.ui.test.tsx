import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import App from '../../../App';
import { createItem } from '../../domain/items/service';
import { shareBackupFile, clearStaleBackupFiles, BACKUP_FILE_GRACE_MS } from '../../domain/backup/files';

/**
 * The backup file holds the whole list, so the copy in the cache folder is
 * only kept long enough to hand over: deleted shortly after the share sheet
 * closes (worked or not), and any left over is cleared at the next start.
 */
const files: Map<string, string> = jest.requireMock('expo-file-system').__files;
const share = Sharing.shareAsync as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  files.clear();
  share.mockReset();
  share.mockResolvedValue(undefined);
});

afterEach(() => jest.useRealTimers());

it('the share sheet gets the whole file; the copy goes shortly after it closes', async () => {
  jest.useFakeTimers();
  await shareBackupFile('{"format":"since-backup"}', '2026-10-23');
  const [uri] = share.mock.calls[0];
  // Still there just after, for the app it went to
  expect(files.get(uri)).toBe('{"format":"since-backup"}');
  act(() => { jest.advanceTimersByTime(BACKUP_FILE_GRACE_MS); });
  expect(files.has(uri)).toBe(false);
});

it('the copy goes too when sharing fails', async () => {
  jest.useFakeTimers();
  share.mockRejectedValueOnce(new Error('no app'));
  await expect(shareBackupFile('{}', '2026-10-23')).rejects.toThrow('no app');
  act(() => { jest.advanceTimersByTime(BACKUP_FILE_GRACE_MS); });
  expect(files.size).toBe(0);
});

it("an earlier export's timer never deletes a newer export's file", async () => {
  jest.useFakeTimers();
  await shareBackupFile('first', '2026-10-23');
  act(() => { jest.advanceTimersByTime(BACKUP_FILE_GRACE_MS - 1000); });
  await shareBackupFile('second', '2026-10-23');
  act(() => { jest.advanceTimersByTime(1000); });
  expect([...files.values()]).toEqual(['second']);
});

it('leftover backup files are cleared; other cached files are left alone', () => {
  files.set('file:///cache/since-backup-2026-10-01.json', '{}');
  files.set('file:///cache/picked.json', 'restore me');
  clearStaleBackupFiles();
  expect([...files.keys()]).toEqual(['file:///cache/picked.json']);
});

it('the app clears leftovers when it starts, and exporting still opens the share sheet', async () => {
  files.set('file:///cache/since-backup-2026-10-01.json', '{}');
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  await waitFor(() => expect(files.has('file:///cache/since-backup-2026-10-01.json')).toBe(false));

  await screen.findByTestId('item-Boiler', {}, { timeout: 5000 });
  fireEvent.press(screen.getByTestId('main-account-button'));
  fireEvent.press(await screen.findByTestId('account-export-button'));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect(JSON.parse(files.get(share.mock.calls[0][0])!).items[0].name).toBe('Boiler');
});
