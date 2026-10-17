/**
 * Auth service — thin wrapper over Supabase auth.
 *
 * Ported from the `since` codebase. Every function requires cloud sync to be
 * configured; callers should gate on isCloudSyncConfigured() first. The app
 * remains fully usable signed-out (local-only), so nothing here is on a
 * critical path.
 */

import { User } from '@supabase/supabase-js';
import { requireSupabase } from '../../lib/supabase';
import { wipeLocalAccountData } from '../sync/engine';

export async function signUp(
  email: string,
  password: string,
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await requireSupabase().auth.signUp({ email, password });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/**
 * Explicit sign-out (decision D3). Signs out of Supabase, then removes the
 * list, queue, owner and reminders from the phone. The caller runs the final
 * sync and warns about unsynced changes first.
 *
 * If the Supabase sign-out fails, nothing is wiped and the error is thrown.
 */
export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
  await wipeLocalAccountData();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email);
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getUser(): Promise<User | null> {
  const { data: { user } } = await requireSupabase().auth.getUser();
  return user;
}

export async function deleteAccount(): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('delete_user');
  if (error) throw error;
  // The account is gone; the local copy of its list goes with it. A failed
  // sign-out call must not stop the wipe.
  await supabase.auth.signOut().catch(() => {});
  await wipeLocalAccountData();
}
