import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

// Backup to a file and restore (sync plan, PR 4), in a local-only build: no
// account needed. File, share sheet and picker are stand-ins (jest.ui.setup.js).
const files: Map<string, string> = jest.requireMock('expo-file-system').__files;

beforeEach(async () => {
  await AsyncStorage.clear();
  files.clear();
  jest.clearAllMocks();
});

/** Make the picker return a file with these contents. */
function pickFile(contents: string) {
  files.set('file:///picked/backup.json', contents);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///picked/backup.json', name: 'backup.json' }],
  });
}

/** Answer the next Alert by pressing the button with this text, if there is one. */
function answerAlert(button?: string) {
  return jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => {
    if (button) buttons?.find((b) => b.text === button)?.onPress?.();
  });
}

async function openBackup() {
  // Wait for the list to load (navigation is ready by then)
  await waitFor(() => expect(screen.queryByTestId('summary-card') ?? screen.queryByTestId('empty-add-button')).toBeTruthy());
  fireEvent.press(screen.getByTestId('main-account-button'));
  return screen.findByTestId('account-export-button');
}

it('the backup screen opens from the list with no account', async () => {
  render(<App />);
  await openBackup();
  expect(screen.getByTestId('account-restore-button')).toBeTruthy();
  expect(screen.queryByTestId('account-sign-in-button')).toBeNull();
});

it('exporting writes the whole list and opens the share sheet', async () => {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  render(<App />);
  fireEvent.press(await openBackup());

  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  const [uri, options] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
  expect(uri).toMatch(/since-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(options).toMatchObject({ mimeType: 'application/json' });
  const backup = JSON.parse(files.get(uri)!);
  expect(backup.format).toBe('since-backup');
  expect(backup.items.map((i: { name: string }) => i.name)).toEqual(['Gutters']);
});

it('restoring shows what it will add, then adds it to the list', async () => {
  // Make a backup holding one item, then start again with an empty list
  await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-04-01', repeatValue: 6, repeatUnit: 'months' });
  const { unmount } = render(<App />);
  fireEvent.press(await openBackup());
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  const backup = files.get((Sharing.shareAsync as jest.Mock).mock.calls[0][0])!;
  unmount();
  await AsyncStorage.clear();

  const second = render(<App />);
  pickFile(backup);
  const alert = answerAlert('Add');
  await openBackup();
  fireEvent.press(screen.getByTestId('account-restore-button'));

  await waitFor(() => expect(alert).toHaveBeenCalledWith(
    'Restore from a backup', '1 item, 1 entry. Add to your list?', expect.any(Array),
  ));
  expect(await screen.findByText('Added to your list.')).toBeTruthy();
  second.unmount();

  // Saved: it's on the list after a restart
  render(<App />);
  expect(await screen.findByTestId('item-Dentist')).toBeTruthy();

  // The same file again adds nothing
  pickFile(backup);
  const again = answerAlert();
  await openBackup();
  fireEvent.press(screen.getByTestId('account-restore-button'));
  await waitFor(() => expect(again).toHaveBeenCalledWith(
    'Restore from a backup', 'Everything in that backup is already in your list.',
  ));
});

it("a file that isn't a backup is refused, and nothing changes", async () => {
  render(<App />);
  pickFile('{"hello": "world"}');
  const alert = answerAlert();
  await openBackup();
  fireEvent.press(screen.getByTestId('account-restore-button'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't restore", "That file isn't a Since backup."));
  expect(await AsyncStorage.getItem('@since_v1_items')).toBeNull();
});
