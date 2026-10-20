/**
 * Emailed codes (D2: codes typed into the app, no links). Pure, so it runs
 * under `npm test`.
 *
 * Signing in and creating an account are one flow: Supabase emails a code to
 * any address, and a new address gets an account when the code is accepted.
 */

/** What a code is for: signing in (or creating an account), or confirming a new email address. */
export type CodePurpose = 'sign_in' | 'email_change';

/** The verifyOtp type for a purpose. 'email' covers both new and existing accounts. */
export function verifyTypeFor(purpose: CodePurpose): 'email' | 'email_change' {
  return purpose === 'sign_in' ? 'email' : 'email_change';
}

/** The line under "Enter your code". */
export function codeSentCopy(purpose: CodePurpose, email: string): string {
  return purpose === 'sign_in'
    ? `We've emailed a code to ${email}. Enter it to sign in.`
    : `We've emailed a code to ${email}. Enter it to switch your account to this address.`;
}
