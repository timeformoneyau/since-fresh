import { SinceItem } from '../../types';

export const STORAGE_VERSION = 1;

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

  return candidates.filter(isValidItem);
}

export function toEnvelope(items: SinceItem[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, items });
}
