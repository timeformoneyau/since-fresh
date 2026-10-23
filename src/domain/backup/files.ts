/**
 * Backup files on the phone: writing one and offering it through the share
 * sheet (save to Files or Drive, email it), and picking one to restore. The
 * rules for what's in a file live in backup.ts.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { backupFileName, isBackupFileName } from './backup';

/**
 * How long the file stays after the share sheet closes. The app it went to
 * (Drive, mail) may still be reading it just after; deleting it at once could
 * cut that copy short. The next start removes it anyway.
 */
export const BACKUP_FILE_GRACE_MS = 30_000;

/** Bumped by every export, so an older export's timer never deletes a newer file. */
let generation = 0;

function remove(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best effort: the cache folder is the system's to clear, and the next start tries again
  }
}

/**
 * Write the backup and open the share sheet. The copy on the phone is only
 * for handing over: it's deleted shortly after the sheet closes, whether the
 * share worked or not. The file holds the whole list, so it shouldn't linger.
 */
export async function shareBackupFile(contents: string, today: string): Promise<void> {
  const file = new File(Paths.cache, backupFileName(today));
  const mine = ++generation;
  file.create({ overwrite: true });
  file.write(contents);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your Since backup',
    });
  } finally {
    setTimeout(() => {
      if (generation === mine) remove(file);
    }, BACKUP_FILE_GRACE_MS);
  }
}

/** Backup files left in the cache folder (the app closed before its timer ran). On app start. */
export function clearStaleBackupFiles(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && isBackupFileName(entry.name)) remove(entry);
    }
  } catch {
    // No cache folder yet, or it can't be read: nothing to clear
  }
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
