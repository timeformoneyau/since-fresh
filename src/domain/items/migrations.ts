import type { SinceItem, CompletionEvent } from '../../types';

/**
 * v1 — { version, items } envelope with expiryDate/source.
 * v2 — adds the `history` completion log (repeat-mode items only).
 * v3 — food tracking removed: expiryDate/source dropped, every item has history.
 *
 * Note: the pre-consolidation `since` codebase also wrote version 1, with a
 * different shape (history but no expiryDate/source). Version number alone
 * therefore cannot identify a payload, so hydrate() discriminates on field
 * presence rather than trusting the envelope version.
 */
export const STORAGE_VERSION = 3;

interface StorageEnvelope {
  version: number;
  items: unknown[];
}

function isValidItem(x: unknown): x is SinceItem {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.category === 'string' &&
    typeof obj.lastDoneDate === 'string' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.updatedAt === 'string'
  );
}

/**
 * Parse raw JSON from AsyncStorage into a validated SinceItem array.
 *
 * Handles two formats:
 *   - Legacy: bare array (written by the original storage.ts before versioning)
 *   - Current: { version: number; items: SinceItem[] } envelope
 *
 * Any item that fails validation is silently dropped rather than crashing.
 * Future schema migrations can be added here as version numbers increase.
 */
export function parseAndMigrate(raw: string): SinceItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  let candidates: unknown[];

  if (Array.isArray(parsed)) {
    // Legacy bare-array format (v0)
    candidates = parsed;
  } else if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'version' in parsed &&
    'items' in parsed
  ) {
    const envelope = parsed as StorageEnvelope;
    candidates = Array.isArray(envelope.items) ? envelope.items : [];
    // Add future migration steps here: if (envelope.version < 2) { ... }
  } else {
    return [];
  }

  return candidates.filter(isValidItem).map(hydrate);
}

/** Fields written by v1/v2 that no longer exist on SinceItem. */
type LegacyItem = SinceItem & { expiryDate?: string | null; source?: string };

/**
 * Bring a stored item up to the current SinceItem shape.
 *
 * Handles payloads written by any prior version, including those from the
 * legacy `since` codebase:
 *
 *   - history (added in v2 here, existed in `since` from the start) is seeded
 *     from lastDoneDate when absent, so an existing user sees one entry.
 *   - expiryDate / source (v1–v2, food tracking) are stripped. An item that
 *     still has an expiryDate was a scanned food item; it becomes a
 *     tracked-only item (no repeat interval, history seeded if empty) rather
 *     than being dropped.
 *   - lastDoneDate with no matching history entry (earlier builds' Edit
 *     screen changed the date without touching history) gets an entry, so
 *     deriving lastDoneDate from history never moves it. Nothing is removed
 *     and lastDoneDate is never rewritten; the added entry's id is fixed, so
 *     running this again changes nothing.
 *   - Entries may carry note and createdAt (redesign); they pass through.
 */
function hydrate(stored: SinceItem): SinceItem {
  const { expiryDate, source: _source, ...item } = stored as LegacyItem;
  const seed: CompletionEvent[] = [{ id: `${item.id}_seed`, date: item.lastDoneDate }];
  const history = Array.isArray(item.history) ? item.history : seed;

  if (expiryDate) {
    return {
      ...item,
      history: history.length > 0 ? history : seed,
      repeatValue: null,
      repeatUnit: null,
    };
  }
  return { ...item, history: withLastDoneEntry(item, history) };
}

function withLastDoneEntry(item: SinceItem, history: CompletionEvent[]): CompletionEvent[] {
  if (history.some((e) => e.date === item.lastDoneDate)) return history;
  const entry: CompletionEvent = { id: `${item.id}_last_${item.lastDoneDate}`, date: item.lastDoneDate };
  // Newest first: it goes before the first entry older than it
  const at = history.findIndex((e) => e.date < item.lastDoneDate);
  return at === -1 ? [...history, entry] : [...history.slice(0, at), entry, ...history.slice(at)];
}

export function toEnvelope(items: SinceItem[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, items });
}
