/**
 * Local-first background sync (decision D1, option B) — platform wiring.
 *
 * Contract:
 *   - Every write lands in AsyncStorage first and always succeeds, online or
 *     off. The UI never waits on the network and never fails because of it.
 *   - Sync is opportunistic: mutations fire it and forget, and it also runs on
 *     app start, on sign-in, when the list regains focus, and when the app
 *     returns from the background (at most every few minutes, resume.ts).
 *   - Signed out, or with no credentials configured, the app is simply a
 *     local-only app. Sync no-ops rather than erroring.
 *
 * The ordering and conflict rules live in runSync.ts, which is pure and
 * tested. This module only supplies the real I/O and guards re-entry.
 */

import { loadItems, saveItems, clearItems } from '../items/storage';
import {
  cloudLoadItems,
  cloudLoadEntries,
  cloudUpsertMany,
  cloudPushEntries,
  cloudDeleteMany,
  cloudLoadTombstones,
} from '../items/cloudStorage';
import { loadCursor, saveCursor, clearCursor } from './cursor';
import { isCloudSyncConfigured, getSupabase } from '../../lib/supabase';
import { loadQueue, removeFromQueue, enqueueUpsert, clearQueue, forgetQueuedItems } from './queue';
import { fetchHousehold, fetchSharedItemKeys } from '../household/cloud';
import { loadHouseholdState, saveHouseholdState, clearHouseholdState } from '../household/store';
import { householdChange, afterLeaving, noLongerShared } from '../household/rules';
import { loadOwner, saveOwner, clearOwner } from './owner';
import {
  rescheduleAllNotifications,
  cancelAllReminders,
} from '../../notifications/scheduler';
import { runSync, SyncPorts, SyncOutcome } from './runSync';
import { applySignIn, OwnershipPorts, SignInResult } from './ownership';
import { classifySyncError } from './classify';
import { saveLastSyncedAt, clearLastSyncedAt } from './lastSynced';
import { SYNC_COPY } from './backupStatus';
import { setSignInNotice } from '../auth/sessionNotice';
import { shouldSyncOnResume } from './resume';

export type { SyncOutcome } from './runSync';
export type { SignInDecision, SignInResult } from './ownership';
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

/** The signed-in account, from the session on the phone. */
async function sessionUserId(): Promise<string | null> {
  const { data: { session } } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
  return session?.user.id ?? null;
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
  cloudPushEntries,
  cloudLoadItems,
  cloudLoadEntries,
  cloudLoadTombstones,
  loadCursor: async () => {
    const userId = await sessionUserId();
    return userId ? loadCursor(userId) : null;
  },
  saveCursor: async (cursor) => {
    const userId = await sessionUserId();
    if (userId) await saveCursor(userId, cursor);
  },
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

/** When the last sync (from any trigger) finished, for the resume throttle. */
let lastFinishedAt: number | null = null;

/** Take items off this phone (they're no longer this account's to see), with their queued changes. */
async function dropItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  await saveItems((await loadItems()).filter((i) => !gone.has(i.id)));
  await forgetQueuedItems(ids);
}

/**
 * Before each sync: look at the household again and apply what changed
 * (household/rules.ts). Leaving takes the household's items off this phone;
 * joining pulls everything again; an item its creator made personal again
 * goes from the other members' phones. Offline, the last known household
 * stays. Only for the account that owns the local list.
 */
async function refreshHousehold(): Promise<void> {
  const userId = await sessionUserId().catch(() => null);
  if (!userId || (await loadOwner()) !== userId) return;
  try {
    const before = await loadHouseholdState();
    const { household, mutes } = await fetchHousehold();
    const change = householdChange(before, userId, household);
    if (change.left) {
      const items = await loadItems();
      const kept = new Set(afterLeaving(items, change.left).map((i) => i.id));
      await dropItems(items.filter((i) => !kept.has(i.id)).map((i) => i.id));
    }
    if (household) {
      await dropItems(noLongerShared(await loadItems(), household.id, await fetchSharedItemKeys(household.id), userId));
    }
    if (change.pullEverything) await clearCursor();
    await saveHouseholdState({ userId, household, mutes });
  } catch {
    // Offline, or households not set up on the server yet (migration 004):
    // keep what's known. A household from another account is never kept.
    const before = await loadHouseholdState();
    if (before.userId !== userId) await saveHouseholdState({ userId, household: null, mutes: [] });
  }
}

export async function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (isCloudSyncConfigured()) await refreshHousehold();
    return runSync(ports);
  })().then(async (outcome) => {
    await afterSync(outcome);
    return outcome;
  });
  try {
    return await inFlight;
  } finally {
    inFlight = null;
    lastFinishedAt = Date.now();
  }
}

/**
 * Sync when the app returns from the background (resume.ts): quietly, only
 * with cloud sync set up, never alongside another run, and at most once every
 * few minutes. Resolves null when it didn't run. Signed out, runSync skips.
 */
export async function syncOnResume(): Promise<SyncOutcome | null> {
  if (!isCloudSyncConfigured()) return null;
  if (!shouldSyncOnResume(lastFinishedAt, Date.now(), inFlight !== null)) return null;
  return syncNow();
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
  await clearCursor();
  await clearHouseholdState();
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

let reconciling: Promise<SignInResult | null> | null = null;

/**
 * Apply the sign-in ownership rule (ownership.ts) for the signed-in account.
 * Local work only, and fast; the caller syncs afterwards. Run on SIGNED_IN
 * and at app start when a session already exists, before the list is shown.
 *
 * confirmReplace is asked before another account's list is removed. When the
 * user declines, the new session is ended on this phone only and the list is
 * kept as it was ('cancelled').
 *
 * Takes the user id rather than reading the session, so it is safe to call
 * from inside an onAuthStateChange callback.
 */
export async function reconcileDeviceOwnership(
  signedInUserId: string,
  confirmReplace?: () => Promise<boolean>,
): Promise<SignInResult | null> {
  if (!isCloudSyncConfigured()) return null;
  if (reconciling) return reconciling;

  reconciling = applySignIn(ownershipPorts, signedInUserId, confirmReplace)
    .then(async (result) => {
      if (result === 'cancelled') {
        await getSupabase()?.auth.signOut({ scope: 'local' }).catch(() => {});
      }
      return result;
    })
    .catch(() => null);
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
