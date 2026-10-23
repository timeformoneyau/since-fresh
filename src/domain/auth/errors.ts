/**
 * Plain-language copy for auth errors (F9).
 *
 * Pure: no Supabase import, so it runs under `npm test`. Errors are matched by
 * the AuthError `code` (see @supabase/auth-js lib/error-codes), never by
 * message text, which Supabase is free to reword.
 */

/** Shared password minimum for sign up, change password and set new password (F11). */
export const MIN_PASSWORD_LENGTH = 8;

export const AUTH_COPY = {
  invalidCredentials: "That email and password don't match.",
  emailNotConfirmed: "Your email isn't confirmed yet. We can send you a code.",
  userExists: "There's already an account with that email. Try signing in.",
  weakPassword: 'That password is too easy to guess. Try a longer one.',
  samePassword: "That's your current password. Choose a new one.",
  rateLimited: 'Too many tries. Wait a minute and try again.',
  badCode: "That code isn't right or has expired. Check it, or send a new one.",
  invalidEmail: "That doesn't look like an email address. Check it and try again.",
  network: "Couldn't reach the server. Check your connection.",
  fallback: 'Something went wrong. Please try again.',
} as const;

const BY_CODE: Record<string, string> = {
  invalid_credentials: AUTH_COPY.invalidCredentials,
  email_not_confirmed: AUTH_COPY.emailNotConfirmed,
  user_already_exists: AUTH_COPY.userExists,
  email_exists: AUTH_COPY.userExists,
  weak_password: AUTH_COPY.weakPassword,
  same_password: AUTH_COPY.samePassword,
  over_request_rate_limit: AUTH_COPY.rateLimited,
  over_email_send_rate_limit: AUTH_COPY.rateLimited,
  // Supabase uses otp_expired for both expired and wrong codes.
  otp_expired: AUTH_COPY.badCode,
  email_address_invalid: AUTH_COPY.invalidEmail,
};

type ErrorLike = { name?: unknown; code?: unknown; status?: unknown; message?: unknown };

export function authErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : undefined;
}

export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as ErrorLike;
  // auth-js wraps failed fetches in AuthRetryableFetchError with status 0;
  // a bare fetch failure in React Native is a TypeError.
  return (
    e.name === 'AuthRetryableFetchError' ||
    (e.name === 'TypeError' && e.message === 'Network request failed')
  );
}

/**
 * Changing to an address another account already holds. Not said as such
 * (readiness audit Q27): saying so would let any signed-in person test which
 * addresses have accounts. The change-email flow carries on exactly as if a
 * code had been sent; none arrives, and the code screen's wording covers
 * that (codes.ts).
 */
export function isEmailTaken(error: unknown): boolean {
  const code = authErrorCode(error);
  return code === 'email_exists' || code === 'user_already_exists';
}

/**
 * Copy for an auth error. Pass 'change-email' from the change-email flow,
 * where "email already exists" reads the same as a wrong code (see
 * isEmailTaken).
 */
export function friendlyAuthError(error: unknown, context?: 'change-email'): string {
  const code = authErrorCode(error);
  if (context === 'change-email' && isEmailTaken(error)) return AUTH_COPY.badCode;
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (isNetworkError(error)) return AUTH_COPY.network;
  if (typeof error === 'object' && error !== null && (error as ErrorLike).status === 429) {
    return AUTH_COPY.rateLimited;
  }
  return AUTH_COPY.fallback;
}
