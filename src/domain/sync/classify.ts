/**
 * Sync failure classification (F5).
 *
 * Pure: no Supabase import, so it runs under `npm test`. Decides what a
 * thrown sync error means for the user. Matching is by error name, code and
 * status, never by message text, except for the fetch-failure prefix that
 * postgrest-js writes into its own messages.
 */

import { isNetworkError } from '../auth/errors.ts';

export type SyncFailure = 'offline' | 'signed-out' | 'error';

/** The session is invalid, expired or revoked, or the user no longer exists. */
const SIGNED_OUT_CODES = new Set([
  // auth-js (lib/error-codes)
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
  'bad_jwt',
  // PostgREST: JWT invalid or failed validation (expired)
  'PGRST301',
  'PGRST303',
]);

type ErrorLike = { name?: unknown; code?: unknown; status?: unknown; message?: unknown };

export function classifySyncError(error: unknown): SyncFailure {
  if (typeof error !== 'object' || error === null) return 'error';
  const e = error as ErrorLike;

  if (isNetworkError(error)) return 'offline';
  // postgrest-js reports a failed fetch as "<fetch error name>: <message>"
  // with an empty code, rather than throwing.
  if (
    e.code === '' &&
    typeof e.message === 'string' &&
    /^(TypeError|FetchError|AbortError): /.test(e.message)
  ) {
    return 'offline';
  }

  if (typeof e.code === 'string' && SIGNED_OUT_CODES.has(e.code)) return 'signed-out';
  if (e.name === 'AuthSessionMissingError') return 'signed-out';
  // Any other 401/403 from the auth server.
  if (
    typeof e.name === 'string' &&
    e.name.startsWith('Auth') &&
    (e.status === 401 || e.status === 403)
  ) {
    return 'signed-out';
  }

  return 'error';
}
