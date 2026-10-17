/**
 * Local-first background sync (decision D1, option B) — platform wiring.
 *
 * Contract:
 *   - Every write lands in AsyncStorage first and always succeeds, online or
 *     off. The UI never waits on the network and never fails because of it.
 *   - Sync is opportunistic: mutations fire it and forget, and it also runs on
 *     app start, on sign-in, and when the list regains focus.
 *   - Signed out, or with no credentials configured, the app is simply a
 *     local-only app. Sync no-ops rather than erroring.
 *
 * The ordering and conflict rules live in runSync.ts, which is pure and
 * tested. This module only supplies the real I/O and guards re-entry.
 */

import { loadItems, saveItems, clearItems } from '../items/storage';
import {
  cloudLoadItems,
  cloudUpsertMany,
  cloudDeleteMany,
  cloudLoadTombstones,
} from '../items/cloudStorage';
import { isCloudSyncConfigured, getSupabase } from '../../lib/supabase';
import { loadQueue, removeFromQueue, enqueueUpsert, clearQueue } from './queue';
import { loadOwner, saveOwner, clearOwner } from './owner';
import {
  rescheduleAllNotifications,
  cancelAllReminders,
} from '../../notifications/scheduler';
import { runSync, SyncPorts, SyncOutcome } from './runSync';
import { applySignIn, OwnershipPorts, SignInDecision } from './ownership';
import { classifySyncError } from './classify';
import { saveLastSyncedAt, clearLastSyncedAt } from './lastSynced';
import { SYNC_COPY } from './backupStatus';
import { setSignInNotice } from '../auth/sessionNotice';

export type { SyncOutcome } from './runSync';
export type { SignInDecision } from './ownership';
export { mergeItems } from './runSync';

async function isAuthenticated(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  // getSession refreshes an expired access token. If that refresh fails, the
  // error is thrown so runSync can classify it (offline, or signed out).
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) return false;
  // The access token is checked locally and stays valid until it expires,
  // even after the session is revoked or the user deleted. getUser asks the
  // auth server, so either is caught on this sync rather than up to an hour
  // later.
  const { error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  return true;
}

async function isOwnedBySignedInUser(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    return (await loadOwner()) === session.user.id;
  } catch {
    return false;
  }
}

const ports: SyncPorts = {
  isConfigured: isCloudSyncConfigured,
  isAuthenticated,
  isOwnedBySignedInUser,
  loadItems,
  saveItems,
  loadQueue,
  removeFromQueue,
  cloudUpsertMany,
  cloudDeleteMany,
  cloudLoadItems,
  cloudLoadTombstones,
  afterMerge: rescheduleAllNotifications,
  classifyError: classifySyncError,
};

/**
 * Act on the outcome: record a successful backup, or end a session the
 * server no longer accepts. Ending it is an involuntary sign-out, so nothing
 * on the phone is wiped; the ownership rule decides at the next sign-in.
 */
async function afterSync(outcome: SyncOutcome): Promise<void> {
  if (outcome === 'synced') {
    await saveLastSyncedAt(new Date().toISOString()).catch(() => {});
  } else if (outcome === 'signed-out') {
    setSignInNotice(SYNC_COPY.signedOut);
    await getSupabase()?.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}

/** Guards against overlapping runs — mutations can fire this rapidly. */
let inFlight: Promise<SyncOutcome> | null = null;

export async function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  inFlight = runSync(ports).then(async (outcome) => {
    await afterSync(outcome);
    return outcome;
  });
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Fire-and-forget trigger for mutation paths. Never blocks the caller. */
export function syncInBackground(): void {
  void syncNow();
}

/** Let any running sync finish, so it cannot write back after a clear. */
async function waitForSync(): Promise<void> {
  if (inFlight) await inFlight;
}

/** Remove the local list, its sync queue and every scheduled reminder. */
async function clearLocalData(): Promise<void> {
  await waitForSync();
  await clearItems();
  await clearQueue();
  await clearLastSyncedAt();
  await cancelAllReminders();
}

const ownershipPorts: OwnershipPorts = {
  loadOwner,
  saveOwner,
  loadItemIds: async () => (await loadItems()).map((i) => i.id),
  enqueueUpsert,
  clearLocalData,
};

let reconciling: Promise<SignInDecision | null> | null = null;

/**
 * Apply the sign-in ownership rule (ownership.ts) for the signed-in account.
 * Local work only, and fast; the caller syncs afterwards. Run on SIGNED_IN
 * and at app start when a session already exists, before the list is shown.
 *
 * Takes the user id rather than reading the session, so it is safe to call
 * from inside an onAuthStateChange callback.
 */
export async function reconcileDeviceOwnership(
  signedInUserId: string,
): Promise<SignInDecision | null> {
  if (!isCloudSyncConfigured()) return null;
  if (reconciling) return reconciling;

  reconciling = applySignIn(ownershipPorts, signedInUserId).catch(() => null);
  try {
    return await reconciling;
  } finally {
    reconciling = null;
  }
}

/**
 * Wipe everything account-specific from the phone (decision D3): items,
 * queue, scheduled reminders and, last, the owner. The owner goes last so
 * that if this is interrupted, the next sign-in still sees the old owner and
 * replaces rather than adopting leftovers.
 *
 * Only for an explicit sign-out or account deletion. An involuntary sign-out
 * (expired session) must not call this.
 */
export async function wipeLocalAccountData(): Promise<void> {
  await clearLocalData();
  await clearOwner();
}
