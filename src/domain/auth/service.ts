/**
 * Auth service — thin wrapper over Supabase auth.
 *
 * Every function requires cloud sync to be configured; callers should gate on
 * isCloudSyncConfigured() first. Signing in is optional: the app is fully
 * usable signed out (local-only), so nothing here is on a critical path.
 *
 * Sign-in is by emailed code only (no passwords). The same code creates an
 * account for a new address.
 */

import { requireSupabase } from '../../lib/supabase';
import { wipeLocalAccountData } from '../sync/engine';
import { CodePurpose, verifyTypeFor } from './codes';
import { isEmailTaken } from './errors';

export type { CodePurpose } from './codes';

/** Emails a sign-in code. A new address gets an account once the code is accepted. */
export async function sendSignInCode(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
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

export async function resendCode(email: string, purpose: CodePurpose): Promise<void> {
  if (purpose === 'sign_in') {
    await sendSignInCode(email);
    return;
  }
  const { error } = await requireSupabase().auth.resend({ type: purpose, email });
  // An address another account holds reads like any other (isEmailTaken)
  if (error && !(purpose === 'email_change' && isEmailTaken(error))) throw error;
}

/**
 * Starts an email change (F10). Supabase emails a code to the new address
 * ("Secure email change" off, so the old address is not asked). The change
 * applies once verifyCode(newEmail, code, 'email_change') succeeds.
 *
 * An address another account already holds resolves just the same, so the
 * flow can't be used to find out which addresses have accounts (isEmailTaken).
 */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ email: newEmail });
  if (error && !isEmailTaken(error)) throw error;
}

/**
 * Verifies an emailed code. For sign-in, success creates a session and the
 * auth listener in App.tsx takes over; for an email change the session
 * continues with the new address.
 */
export async function verifyCode(
  email: string,
  code: string,
  purpose: CodePurpose,
): Promise<void> {
  const { error } = await requireSupabase().auth.verifyOtp({
    email,
    token: code,
    type: verifyTypeFor(purpose),
  });
  if (error) throw error;
}

/**
 * The signed-in account, from the session on the phone (no network), or null
 * when signed out. Offline, a signed-in user still reads as signed in.
 */
export async function getSignedInUser(): Promise<{ email: string } | null> {
  const { data: { session } } = await requireSupabase().auth.getSession();
  return session ? { email: session.user.email ?? '' } : null;
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
