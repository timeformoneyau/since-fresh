/**
 * When to ask for notification permission, and what to say. Pure, so it
 * runs under `npm test`; permissionFlow.ts does the asking.
 *
 * Asked once, when it matters: the first time a repeating item is saved,
 * after a one-screen explanation with a real "Not now". Never asked again
 * after that. If reminders are off while there are repeating items, the list
 * shows one calm notice that can be dismissed, and Settings says so too.
 *
 * Android 13+ shows its own prompt only a limited number of times; after
 * that (canAskAgain false), "Turn on" opens the phone's settings instead.
 */

export interface PermissionState {
  granted: boolean;
  /** False once Android won't show its prompt again. */
  canAskAgain: boolean;
}

/** Kept on this phone (permissionStore.ts). Absent fields mean "not yet". */
export interface ReminderPromptPrefs {
  /** The explanation was shown and answered (either way). */
  explained?: boolean;
  /** The "Reminders are off" notice on the list was dismissed. */
  noticeDismissed?: boolean;
}

export const REMINDERS_COPY = {
  heading: 'Turn on reminders?',
  body: 'So we can remind you when something comes round. Reminders come at the time you choose, and only when something needs it.',
  blockedBody: "Reminders are turned off for Since on this phone. You can turn them on in your phone's settings.",
  turnOn: 'Turn on reminders',
  openSettings: 'Open settings',
  notNow: 'Not now',
  offNotice: "Reminders are off, so Since can't nudge you. Turn them on in settings.",
  dismiss: 'Hide',
  settingsOff: "Reminders are off on this phone, so Since can't nudge you. Turn them on in settings.",
} as const;

/** Show the explanation now? Only on saving a repeating item, only if not granted, only once. */
export function shouldExplain(perm: PermissionState, prefs: ReminderPromptPrefs, savedRepeating: boolean): boolean {
  return savedRepeating && !perm.granted && !prefs.explained;
}

/** Show the "Reminders are off" notice on the list? */
export function shouldShowOffNotice(
  perm: PermissionState,
  prefs: ReminderPromptPrefs,
  hasRepeating: boolean,
): boolean {
  return hasRepeating && !perm.granted && !prefs.noticeDismissed;
}

/** What "Turn on" does: the system prompt while Android still shows it, else the phone's settings. */
export function turnOnAction(perm: PermissionState): 'ask' | 'settings' {
  return perm.canAskAgain ? 'ask' : 'settings';
}

/** Read whatever expo-notifications returns, defensively. */
export function readPermission(raw: unknown): PermissionState {
  const r = (raw ?? {}) as { granted?: unknown; status?: unknown; canAskAgain?: unknown };
  const granted = r.granted === true || r.status === 'granted';
  return { granted, canAskAgain: r.canAskAgain !== false };
}

/** Stored prefs, whatever was saved. Anything unreadable means "not yet". */
export function readPrefs(raw: unknown): ReminderPromptPrefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(r.explained === true ? { explained: true } : {}),
    ...(r.noticeDismissed === true ? { noticeDismissed: true } : {}),
  };
}
