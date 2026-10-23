/**
 * Household and invite errors (migration 006). Pure, so it runs under
 * `npm test`; service.ts re-exports it for screens.
 */

/**
 * Household and invite errors in the app's own words, by the stable hint
 * migration 006 gives each one (never by message text, which the server may
 * reword). The messages match the server's, so older builds, which show the
 * server's message, read the same.
 */
export const HOUSEHOLD_COPY = {
  wrongCode: "That code isn't right or has expired.",
  rateLimited: "Too many codes that didn't work. Wait 15 minutes, then try again.",
  joinBusy: 'Joining is paused for a few minutes. Please try again later.',
  householdFull: 'That household is full. It can have up to 50 people.',
  tooManyInvites: 'There are already 50 invite codes waiting to be used. They stop working after 7 days.',
  notSetUp: "Households aren't set up on the server yet.",
  offline: "Couldn't reach the server. Check your connection and try again.",
} as const;

const BY_HINT: Record<string, string> = {
  since_join_rate_limited: HOUSEHOLD_COPY.rateLimited,
  since_join_busy: HOUSEHOLD_COPY.joinBusy,
  since_household_full: HOUSEHOLD_COPY.householdFull,
  since_too_many_invites: HOUSEHOLD_COPY.tooManyInvites,
};

/** Household and invite errors the database raises, in plain words. */
export function householdErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; hint?: unknown };
  if (typeof e.hint === 'string' && BY_HINT[e.hint]) return BY_HINT[e.hint];
  // A wrong, revoked or expired code (returned by 006, raised before it)
  if (e.code === 'P0002') return HOUSEHOLD_COPY.wrongCode;
  // Our own functions raise their message for these (004_households.sql)
  if ((e.code === 'P0001' || e.code === '42501') && typeof e.message === 'string') {
    return e.message;
  }
  if (e.code === 'PGRST202' || e.code === '42883') {
    return HOUSEHOLD_COPY.notSetUp;
  }
  return HOUSEHOLD_COPY.offline;
}

/**
 * join_household returns a wrong code as an error body with HTTP 404
 * (migration 006). If the server ever answered 200 instead, that body would
 * arrive as data; read it as the error it is, so a wrong code never looks
 * like a successful join.
 */
export function joinResultError(data: unknown): { code: string; message: string } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  return typeof code === 'string' ? { code, message: typeof message === 'string' ? message : '' } : null;
}
