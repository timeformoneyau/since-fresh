/**
 * Size limits on synced writes (migration 006) and what a refusal means.
 * Pure, so it runs under `npm test`.
 *
 * The server refuses an item or entry over a limit with its own SQLSTATE
 * (SN001–SN007). That refusal is permanent: sending the same change again
 * gets the same answer. So sync doesn't retry it or let it hold up the rest
 * of the queue. It parks the change ("can't sync yet"): the data stays on the
 * phone, the item says what to change, and editing the item tries again
 * (queueOps.ts, runSync.ts).
 *
 * The limits are checked here too, before anything is sent, so a change the
 * server would refuse is parked without a round trip. The server still has
 * the last word: anything it refuses with an SN code is parked as well.
 */

import type { SinceItem } from '../../types';

/** The same numbers as 006_play_hardening.sql. The screens stay well inside them. */
export const LIMITS = {
  name: 500,
  category: 100,
  note: 5000,
  historyEntries: 20000,
  historyBytes: 10 * 1024 * 1024,
} as const;

export const REFUSAL = {
  nameTooLong: 'SN001',
  categoryTooLong: 'SN002',
  historyTooManyEntries: 'SN003',
  historyTooLarge: 'SN004',
  noteTooLong: 'SN005',
  tooManyEntries: 'SN006',
  tooManyItems: 'SN007',
} as const;

/** The hint each code carries, for a server that reports the hint but not the code. */
const BY_HINT: Record<string, string> = {
  since_item_name_too_long: REFUSAL.nameTooLong,
  since_item_category_too_long: REFUSAL.categoryTooLong,
  since_history_too_many_entries: REFUSAL.historyTooManyEntries,
  since_history_too_large: REFUSAL.historyTooLarge,
  since_note_too_long: REFUSAL.noteTooLong,
  since_too_many_entries: REFUSAL.tooManyEntries,
  since_too_many_items: REFUSAL.tooManyItems,
};

/**
 * The SN code when the server refused a write permanently, else null
 * (offline, signed out, a server hiccup: worth trying again as before).
 */
export function refusalCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, hint } = error as { code?: unknown; hint?: unknown };
  if (typeof code === 'string' && /^SN\d{3}$/.test(code)) return code;
  if (typeof hint === 'string' && BY_HINT[hint]) return BY_HINT[hint];
  return null;
}

/** What to tell the person, on the item, for a parked change. */
export const PARKED_COPY: Record<string, string> = {
  [REFUSAL.nameTooLong]: 'This name is too long to sync. Shorten it and it will go through.',
  [REFUSAL.categoryTooLong]: 'This category is too long to sync. Choose another one and it will go through.',
  [REFUSAL.historyTooManyEntries]:
    'This item has too many history entries to sync. Delete some older ones and it will go through.',
  [REFUSAL.historyTooLarge]:
    "This item's history is too large to sync. Shorten long notes or delete some older entries and it will go through.",
  [REFUSAL.noteTooLong]: 'A note on this item is too long to sync. Shorten it and it will go through.',
  [REFUSAL.tooManyEntries]:
    'This item has too many history entries to sync. Delete some older ones and it will go through.',
  [REFUSAL.tooManyItems]:
    "Your account has reached 5,000 items, so this one can't sync yet. Delete some you no longer need and it will go through.",
};

const FALLBACK = "This item can't sync yet. Edit it and it will try again.";

export function parkedMessage(code: string): string {
  return PARKED_COPY[code] ?? FALLBACK;
}

/** Characters as Postgres counts them (code points, not UTF-16 units). */
const chars = (s: string | undefined | null) => (s ? [...s].length : 0);

function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** A note over the limit, for an entry being sent on its own. */
export function noteProblem(note: string | undefined | null): string | null {
  return chars(note) > LIMITS.note ? REFUSAL.noteTooLong : null;
}

/**
 * Why the server would refuse this item's row and its entries, or null.
 * For an item push: the row (name, category, history) and every entry,
 * which are sent with it.
 */
export function itemProblem(item: SinceItem): string | null {
  if (chars(item.name) > LIMITS.name) return REFUSAL.nameTooLong;
  if (chars(item.category) > LIMITS.category) return REFUSAL.categoryTooLong;
  const history = Array.isArray(item.history) ? item.history : [];
  if (history.length > LIMITS.historyEntries) return REFUSAL.historyTooManyEntries;
  if (history.some((e) => noteProblem(e?.note))) return REFUSAL.noteTooLong;
  // Postgres measures its own text form, which is a little longer than JSON
  // from JavaScript; the server catches the difference.
  if (utf8Bytes(JSON.stringify(history)) > LIMITS.historyBytes) return REFUSAL.historyTooLarge;
  return null;
}
