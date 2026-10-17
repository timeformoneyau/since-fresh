/** Resend cooldown for emailed codes. Pure, so it runs under `npm test`. */

export const RESEND_COOLDOWN_SECONDS = 60;

/** Whole seconds until another code may be sent; 0 when it may be sent now. */
export function secondsUntilResend(
  lastSentAt: number | null,
  now: number,
  cooldownSeconds: number = RESEND_COOLDOWN_SECONDS,
): number {
  if (lastSentAt === null) return 0;
  const remainingMs = lastSentAt + cooldownSeconds * 1000 - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/** A 6–8 digit numeric code (the project's OTP length is configurable). */
export function isValidCodeFormat(code: string): boolean {
  return /^\d{6,8}$/.test(code);
}
