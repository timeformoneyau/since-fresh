/**
 * When the password-recovery hold (recovery.ts) is set or released. Pure, so
 * it runs under `npm test`.
 */

export type RecoveryEvent =
  | 'recovery-verify-started'
  | 'recovery-verify-failed'
  | 'password-saved'
  | 'recovery-abandoned'
  // An ordinary email-and-password sign-in. A hold left over from a recovery
  // interrupted mid-verify must not send this user to "Set a new password".
  | 'password-sign-in'
  // App start with no session: there is no recovery session to hold.
  | 'started-without-session';

export function recoveryPendingAfter(event: RecoveryEvent): boolean {
  return event === 'recovery-verify-started';
}
