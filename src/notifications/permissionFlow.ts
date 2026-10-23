/**
 * Asking for notification permission (rules in permission.ts). Screens call
 * these; nothing here runs at app start.
 */

import { Linking } from 'react-native';
import { getReminderPermission, askForReminderPermission } from './scheduler';
import { loadPromptPrefs, updatePromptPrefs } from './permissionStore';
import { shouldExplain, shouldShowOffNotice, turnOnAction, type PermissionState } from './permission';
import { refreshReminders } from '../domain/items/service';

const NOT_GRANTED: PermissionState = { granted: false, canAskAgain: true };

async function permission(): Promise<PermissionState> {
  return getReminderPermission().catch(() => NOT_GRANTED);
}

/** After saving: should the explanation show? Only for a repeating item, once. */
export async function needsReminderExplanation(savedRepeating: boolean): Promise<boolean> {
  if (!savedRepeating) return false;
  return shouldExplain(await permission(), await loadPromptPrefs(), savedRepeating);
}

/** For the explanation screen: whether Android will still show its prompt. */
export const currentReminderPermission = permission;

/**
 * "Turn on reminders": the system prompt while Android still shows it, else
 * the phone's settings. Answered either way, so it's never asked again.
 * Granted: every reminder is scheduled again straight away.
 */
export async function turnOnReminders(): Promise<PermissionState> {
  await updatePromptPrefs({ explained: true });
  const now = await permission();
  if (now.granted) return now;
  if (turnOnAction(now) === 'settings') {
    await Linking.openSettings().catch(() => {});
    return now;
  }
  const answer = await askForReminderPermission().catch(() => now);
  if (answer.granted) await refreshReminders().catch(() => {});
  return answer;
}

/** "Not now" (or leaving the screen): answered; not asked again. */
export async function notNowReminders(): Promise<void> {
  await updatePromptPrefs({ explained: true });
}

/** The list's "Reminders are off" notice: whether to show it. */
export async function remindersOffNoticeVisible(hasRepeating: boolean): Promise<boolean> {
  return shouldShowOffNotice(await permission(), await loadPromptPrefs(), hasRepeating);
}

export async function dismissRemindersOffNotice(): Promise<void> {
  await updatePromptPrefs({ noticeDismissed: true });
}

export async function openReminderSettings(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}

/** Last known answer, to notice when it changes to granted (in settings, while away). */
let lastGranted: boolean | null = null;

/**
 * Look again (on return to the app): if reminders have just been turned on,
 * schedule every reminder again. Resolves whether they're on.
 */
export async function recheckReminderPermission(): Promise<boolean> {
  const { granted } = await permission();
  if (granted && lastGranted === false) await refreshReminders().catch(() => {});
  lastGranted = granted;
  return granted;
}
