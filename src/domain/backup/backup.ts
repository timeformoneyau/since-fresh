/**
 * Backup files — pure rules, so they run under `npm test`. Works with no
 * account: the file is the list as JSON, and restoring adds what's missing.
 *
 * A backup file is the storage envelope with a marker:
 *   { format: 'since-backup', version: 1, exportedAt, storageVersion, items }
 * Restoring reads its items through the same parseAndMigrate as the phone's
 * own storage, so a backup from any build loads like stored data does.
 *
 * Restoring merges and never replaces:
 *   - An item already on the phone (same id) keeps its fields; any history
 *     entries it lacks are added.
 *   - An item not on the phone is added under a new id, as this account's own
 *     and Just me: no owner, household or person looking after it, as those
 *     may not be this account's (households). The cloud tombstones
 *     deleted ids, so an item restored with its old id would vanish at the
 *     next sync if it was deleted there (CLAUDE.md, data safety).
 *   - Entries already on the phone are left as they are.
 *   - An item is "already on the phone" if it has the same id, or shares a
 *     history entry with one (an item restored before keeps its entries' ids
 *     under its new id), so restoring the same file twice adds nothing.
 */

import type { SinceItem, CompletionEvent } from '../../types';
import { parseAndMigrate, STORAGE_VERSION } from '../items/migrations.ts';
import { sortNewestFirst } from '../items/history.ts';

export const BACKUP_FORMAT = 'since-backup';
export const BACKUP_VERSION = 1;

export function toBackup(items: SinceItem[], exportedAt: string): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    storageVersion: STORAGE_VERSION,
    items,
  });
}

/** "since-backup-2026-10-20.json" */
export function backupFileName(today: string): string {
  return `${BACKUP_FORMAT}-${today}.json`;
}

/** A file this app wrote for the share sheet (only those are cleared from the cache folder). */
export function isBackupFileName(name: string): boolean {
  return /^since-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name);
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export const BACKUP_COPY = {
  notABackup: "That file isn't a Since backup.",
  tooNew: 'That backup is from a newer version of Since. Update the app, then try again.',
  nothingNew: 'Everything in that backup is already in your list.',
} as const;

/** The items in a backup file, or a BackupError saying plainly why not. */
export function readBackup(raw: string): SinceItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupError(BACKUP_COPY.notABackup);
  }
  const b = (parsed ?? {}) as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT || !Array.isArray(b.items)) {
    throw new BackupError(BACKUP_COPY.notABackup);
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupError(BACKUP_COPY.tooNew);
  }
  const storageVersion = typeof b.storageVersion === 'number' ? b.storageVersion : STORAGE_VERSION;
  return parseAndMigrate(JSON.stringify({ version: storageVersion, items: b.items }));
}

export interface RestorePlan {
  /** Items to add, already under their new ids. */
  added: SinceItem[];
  /** Items on the phone that gain entries, with those entries' ids. */
  extended: Array<{ item: SinceItem; entryIds: string[] }>;
  /** Totals for the preview. */
  itemCount: number;
  entryCount: number;
}

/** What restoring `backup` onto `local` would add. `newId` makes ids for added items. */
export function planRestore(
  local: SinceItem[],
  backup: SinceItem[],
  newId: () => string,
  now: string,
): RestorePlan {
  const mine = new Map(local.map((i) => [i.id, i]));
  // An item restored before took a new id but kept its entries' ids, so an
  // entry id also identifies it: the same file never adds it twice.
  const byEntry = new Map(local.flatMap((i) => i.history.map((e) => [e.id, i] as const)));
  const added: SinceItem[] = [];
  const extended: RestorePlan['extended'] = [];

  for (const incoming of backup) {
    const existing =
      mine.get(incoming.id) ??
      incoming.history.map((e) => byEntry.get(e.id)).find((i): i is SinceItem => i !== undefined);
    if (!existing) {
      // Added as this account's own and just for me: the backup's owner,
      // household and who looked after it may not be this account's
      const { ownerId: _owner, householdId: _household, lookedAfterBy: _who, ...own } = incoming;
      added.push({ ...own, id: newId(), updatedAt: now });
      continue;
    }
    const known = new Set(existing.history.map((e) => e.id));
    const missing: CompletionEvent[] = incoming.history.filter((e) => !known.has(e.id));
    if (missing.length === 0) continue;
    const history = sortNewestFirst([...existing.history, ...missing]);
    extended.push({
      item: { ...existing, history, lastDoneDate: history[0].date, updatedAt: now },
      entryIds: missing.map((e) => e.id),
    });
  }

  const entryCount =
    added.reduce((n, i) => n + i.history.length, 0) +
    extended.reduce((n, x) => n + x.entryIds.length, 0);
  return { added, extended, itemCount: added.length, entryCount };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 items, 31 entries. Add to your list?", or null when there's nothing new. */
export function describeRestore(plan: RestorePlan): string | null {
  if (plan.itemCount === 0 && plan.entryCount === 0) return null;
  const parts: string[] = [];
  if (plan.itemCount > 0) parts.push(plural(plan.itemCount, 'item', 'items'));
  parts.push(plural(plan.entryCount, 'entry', 'entries'));
  return `${parts.join(', ')}. Add to your list?`;
}
