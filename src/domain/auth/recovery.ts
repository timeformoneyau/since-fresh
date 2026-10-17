/**
 * Password-recovery hold (F1).
 *
 * A correct recovery code creates a session, and App.tsx shows the main app
 * for any session. While this flag is set, App.tsx shows "Set a new password"
 * instead, whichever auth event fired. It is stored so a restart mid-recovery
 * still lands on that screen, and cleared when the password is saved, the
 * user backs out (which signs them out), an ordinary sign-in succeeds, or the
 * app starts with no session (recoveryRules.ts).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoveryPendingAfter, RecoveryEvent } from './recoveryRules';

const RECOVERY_KEY = '@since_recovery_pending_v1';

type Listener = (pending: boolean) => void;
const listeners = new Set<Listener>();

export async function loadRecoveryPending(): Promise<boolean> {
  return (await AsyncStorage.getItem(RECOVERY_KEY)) === '1';
}

export async function setRecoveryPending(pending: boolean): Promise<void> {
  if (pending) await AsyncStorage.setItem(RECOVERY_KEY, '1');
  else await AsyncStorage.removeItem(RECOVERY_KEY);
  listeners.forEach((l) => l(pending));
}

export function onRecoveryPendingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function applyRecoveryEvent(event: RecoveryEvent): Promise<void> {
  await setRecoveryPending(recoveryPendingAfter(event));
}
