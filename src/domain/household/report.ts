/**
 * "Report a problem" in households, for Google Play's user-generated content
 * policy: what people write in a household (its name, display names, item
 * names and notes) is seen by the others in it, so anyone in a household
 * needs a way to report content or a person from inside the app.
 *
 * Reports go by email to SUPPORT_EMAIL. Pure, so it runs under `npm test`.
 */

/**
 * Where reports go. Empty until the owner chooses an address: while it's
 * empty the app doesn't show "Report a problem" at all, rather than a link
 * that goes nowhere. Set it before the app goes on Google Play. This file is
 * public, like the rest of the repo.
 */
export const SUPPORT_EMAIL = '';

export const REPORT_SUBJECT = 'Report a problem in a Since household';

/** The mailto: link for a report, or null while there's no address to send it to. */
export function reportProblemUrl(email: string, household: { id: string; name: string }): string | null {
  const to = email.trim();
  if (!to) return null;
  const body = [
    'What happened?',
    '',
    '',
    'Who or what is it about (a person, an item or a note)?',
    '',
    '',
    `Household: ${household.name}`,
    `Reference: ${household.id}`,
  ].join('\n');
  return `mailto:${to}?subject=${encodeURIComponent(REPORT_SUBJECT)}&body=${encodeURIComponent(body)}`;
}

/**
 * What's OK to share (Play's UGC policy asks for rules people agree to before
 * they share). Shown on Create and Join, where going ahead is agreeing, and
 * in Account → Household.
 */
export const HOUSEHOLD_RULES =
  "Everyone in the household sees its name, your name, and the items and notes you share. Keep them kind: nothing abusive, hateful, sexual or illegal.";

export function agreeToRulesText(joining: boolean): string {
  return `By ${joining ? 'joining' : 'creating a household'}, you agree to this. Anyone can leave a household at any time, and its owner can remove people.`;
}
