/**
 * Backup files on the phone: writing one and offering it through the share
 * sheet (save to Files or Drive, email it), and picking one to restore. The
 * rules for what's in a file live in backup.ts.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { backupFileName } from './backup';

/** Write the backup and open the share sheet. */
export async function shareBackupFile(contents: string, today: string): Promise<void> {
  const file = new File(Paths.cache, backupFileName(today));
  file.create({ overwrite: true });
  file.write(contents);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save your Since backup',
  });
}

/** The chosen file's contents, or null if the user backed out. */
export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return new File(result.assets[0].uri).text();
}
