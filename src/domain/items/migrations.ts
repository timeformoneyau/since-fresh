import { SinceItem, CompletionEvent } from '../../types';

/**
 * v1 — { version, items } envelope with expiryDate/source.
 * v2 — adds the `history` completion log (repeat-mode items only).
 *
 * Note: the pre-consolidation `since` codebase also wrote version 1, with a
 * different shape (history but no expiryDate/source). Version number alone
 * therefore cannot identify a payload, so hydrate() discriminates on field
 * presence rather than trusting the envelope version.
 */
export const STORAGE_VERSION = 2;

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

/**
 * Bring a stored item up to the current SinceItem shape.
 *
 * Handles payloads written by any prior version, including those from the
 * legacy `since` codebase, by filling in whichever fields are absent:
 *
 *   - expiryDate / source (added in v1 here, never existed in `since`)
 *   - history (added in v2 here, existed in `since` from the start)
 *
 * History is seeded from lastDoneDate for repeat-mode items so an existing
 * user sees at least one entry. Expiry-mode items get an empty history by
 * design — food is replaced by the next scan, not logged.
 */
function hydrate(item: SinceItem): SinceItem {
  const expiryDate = item.expiryDate ?? null;

  let history: CompletionEvent[];
  if (Array.isArray(item.history)) {
    history = item.history;
  } else if (expiryDate) {
    history = [];
  } else {
    history = [{ id: `${item.id}_seed`, date: item.lastDoneDate }];
  }

  return {
    ...item,
    history,
    expiryDate,
    source: item.source ?? 'manual',
  };
}

export function toEnvelope(items: SinceItem[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, items });
}
