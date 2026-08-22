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

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
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
  await supabase.auth.signOut();
}
