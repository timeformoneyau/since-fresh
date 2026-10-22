/**
 * Supabase row mapping for items.
 *
 * This module is transport only — it does not decide *when* to sync. That
 * belongs to domain/sync/engine.ts. Every function here assumes the caller
 * has confirmed cloud sync is configured and the user is authenticated, and
 * will throw otherwise; the sync engine classifies those throws (classify.ts).
 */

import { SinceItem, CompletionEvent, RepeatUnit } from '../../types';
import { requireSupabase } from '../../lib/supabase';
import type { CloudItem, CloudEntry, EntryPush, EntryRow } from '../sync/runSync';
import { serverTimeMs } from '../sync/runSync';
import { lookedAfterBy } from '../household/rules';

export interface ItemRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  last_done_date: string;
  history: unknown;
  repeat_value: number | null;
  repeat_unit: string | null;
  created_at: string;
  updated_at: string;
  /** Set by the database (migration 003); never sent. */
  server_updated_at?: string;
  /** Migration 004: the household it's shared with, or null. */
  household_id?: string | null;
  /** Migration 005: the member who looks after it, or null for Anyone. */
  looked_after_by?: string | null;
}

interface EntryDbRow {
  user_id: string;
  item_id: string;
  id: string;
  date: string;
  note: string | null;
  created_at?: string;
  deleted_at?: string | null;
  server_updated_at?: string;
  created_by?: string | null;
}

/**
 * An item from the cloud. ownerId is set only for someone else's item (a
 * household member's shared item); this account's items carry none, like
 * items made on the phone.
 */
export function rowToItem(row: ItemRow, me: string): CloudItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    lastDoneDate: row.last_done_date,
    history: Array.isArray(row.history) ? (row.history as CompletionEvent[]) : [],
    repeatValue: row.repeat_value,
    repeatUnit: row.repeat_unit as RepeatUnit | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.server_updated_at ? { serverUpdatedAt: row.server_updated_at } : {}),
    ...(row.user_id !== me ? { ownerId: row.user_id } : {}),
    ...(row.household_id !== undefined ? { householdId: row.household_id } : {}),
    ...(row.looked_after_by !== undefined ? { lookedAfterBy: row.looked_after_by } : {}),
  };
}

function rowToEntry(row: EntryDbRow): CloudEntry {
  return {
    itemId: row.item_id,
    id: row.id,
    date: row.date,
    note: row.note,
    createdAt: row.created_at ?? null,
    deletedAt: row.deleted_at ?? null,
    serverUpdatedAt: row.server_updated_at ?? '',
    createdBy: row.created_by ?? null,
  };
}

/** Entries are keyed by their item's owner, who may be another member. */
function entryToRow(e: EntryRow, userId: string): EntryDbRow {
  return {
    user_id: e.ownerId ?? userId,
    item_id: e.itemId,
    id: e.id,
    date: e.date,
    note: e.note,
    ...(e.createdAt ? { created_at: e.createdAt } : {}),
  };
}

/**
 * Pulls start a little before the cursor: a row written in a transaction that
 * began earlier can commit with an earlier change time than one already seen.
 * Rows pulled twice merge the same way, so the overlap costs nothing.
 */
const PULL_OVERLAP_MS = 2 * 60_000;
const PAGE = 1000; // PostgREST's default row limit

function pullFrom(since: string | null): string | null {
  if (!since) return null;
  const t = serverTimeMs(since);
  return Number.isNaN(t) ? null : new Date(t - PULL_OVERLAP_MS).toISOString();
}

/** Every row a query returns, a page at a time. */
async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/**
 * A shared item keeps its owner's key, whoever pushes it. household_id is
 * only sent once an item has been shared or unshared, and looked_after_by
 * once someone has been chosen (or the item came from a project with
 * migration 005), so builds talking to a project without those migrations
 * never send them. A personal item always sends null: the server refuses a
 * person on an item with no household.
 */
export function itemToRow(item: SinceItem, userId: string): ItemRow {
  return {
    id: item.id,
    user_id: item.ownerId ?? userId,
    ...(item.householdId !== undefined ? { household_id: item.householdId } : {}),
    ...(item.lookedAfterBy !== undefined ? { looked_after_by: lookedAfterBy(item) } : {}),
    name: item.name,
    category: item.category,
    last_done_date: item.lastDoneDate,
    history: item.history,
    repeat_value: item.repeatValue,
    repeat_unit: item.repeatUnit,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export async function currentUserId(): Promise<string> {
  // getUser asks the auth server, so a revoked session or deleted user
  // surfaces here; throw its error so sync can classify it (classify.ts).
  const { data: { user }, error } = await requireSupabase().auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/** Items changed since `since` (by the server's change time), or all of them. */
export async function cloudLoadItems(since: string | null = null): Promise<CloudItem[]> {
  const from = pullFrom(since);
  const rows = await allPages<ItemRow>((a, b) => {
    let q = requireSupabase().from('items').select('*');
    if (from) q = q.gt('server_updated_at', from);
    return q.order('server_updated_at', { ascending: true }).order('id').range(a, b);
  });
  const me = await currentUserId();
  return rows.map((r) => rowToItem(r, me));
}

/** History entries changed since `since`, or all of them; optionally only for some items. */
export async function cloudLoadEntries(
  since: string | null = null,
  itemIds?: string[],
): Promise<CloudEntry[]> {
  if (itemIds && itemIds.length === 0) return [];
  const from = pullFrom(since);
  const rows = await allPages<EntryDbRow>((a, b) => {
    let q = requireSupabase()
      .from('completion_events')
      .select('item_id, id, date, note, created_at, deleted_at, server_updated_at, created_by');
    if (from) q = q.gt('server_updated_at', from);
    if (itemIds) q = q.in('item_id', itemIds);
    return q.order('server_updated_at', { ascending: true }).order('item_id').order('id').range(a, b);
  });
  return rows.map(rowToEntry);
}

/**
 * Send history entry changes. Insert-only rows never overwrite the cloud's
 * copy; overwrites change date and note but can't bring back an entry
 * another phone deleted (deleted_at isn't sent). Item rows must be pushed
 * first: an entry needs its item.
 */
export async function cloudPushEntries(push: EntryPush): Promise<void> {
  const { insertOnly, overwrite, softDelete } = push;
  if (insertOnly.length + overwrite.length + softDelete.length === 0) return;
  const supabase = requireSupabase();
  const userId = await currentUserId();
  const onConflict = 'user_id,item_id,id';

  if (insertOnly.length > 0) {
    const { error } = await supabase
      .from('completion_events')
      .upsert(insertOnly.map((e) => entryToRow(e, userId)), { onConflict, ignoreDuplicates: true });
    if (error) throw error;
  }
  if (overwrite.length > 0) {
    const { error } = await supabase
      .from('completion_events')
      .upsert(overwrite.map((e) => entryToRow(e, userId)), { onConflict });
    if (error) throw error;
  }

  const byItem = new Map<string, { ownerId: string; itemId: string; ids: string[] }>();
  for (const r of softDelete) {
    const ownerId = r.ownerId ?? userId;
    const key = `${ownerId}/${r.itemId}`;
    const group = byItem.get(key) ?? { ownerId, itemId: r.itemId, ids: [] };
    group.ids.push(r.entryId);
    byItem.set(key, group);
  }
  for (const { ownerId, itemId, ids } of byItem.values()) {
    const { error } = await supabase
      .from('completion_events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', ownerId)
      .eq('item_id', itemId)
      .in('id', ids)
      .is('deleted_at', null);
    if (error) throw error;
  }
}

/**
 * This account's items are upserted. Another member's shared item is
 * updated in place: Postgres checks an upsert against the insert rule even
 * when the row exists, and only an item's owner may insert it
 * (004_households.sql), so an upsert would be refused.
 */
export async function cloudUpsertMany(items: SinceItem[]): Promise<void> {
  if (items.length === 0) return;
  const supabase = requireSupabase();
  const userId = await currentUserId();
  const mine = items.filter((i) => !i.ownerId || i.ownerId === userId);
  const theirs = items.filter((i) => i.ownerId && i.ownerId !== userId);

  if (mine.length > 0) {
    // The key is (user_id, id): two accounts may hold the same item id.
    const { error } = await supabase
      .from('items')
      .upsert(mine.map((item) => itemToRow(item, userId)), { onConflict: 'user_id,id' });
    if (error) throw error;
  }
  for (const item of theirs) {
    // An item no longer shared updates nothing; the next household check drops it
    const { user_id: owner, id, created_at: _created, ...fields } = itemToRow(item, userId);
    const { error } = await supabase.from('items').update(fields).eq('user_id', owner).eq('id', id);
    if (error) throw error;
  }
}

/**
 * Delete items and record tombstones, so the deletion survives a pull on
 * another device that still holds the item.
 */
export async function cloudDeleteMany(
  ids: string[],
  meta: Record<string, { ownerId?: string; householdId?: string | null }> = {},
): Promise<void> {
  if (ids.length === 0) return;
  const supabase = requireSupabase();
  const userId = await currentUserId();
  const ownerOf = (id: string) => meta[id]?.ownerId ?? userId;

  // A shared item's tombstone carries its household, so every member sees it
  const { error: tombErr } = await supabase
    .from('deleted_items')
    .upsert(
      ids.map((id) => ({
        id,
        user_id: ownerOf(id),
        ...(meta[id]?.householdId ? { household_id: meta[id].householdId } : {}),
      })),
      { onConflict: 'id,user_id' },
    );
  if (tombErr) throw tombErr;

  // Scoped to each item's owner explicitly, not only through RLS: ids are
  // unique per account, not globally.
  const byOwner = new Map<string, string[]>();
  for (const id of ids) byOwner.set(ownerOf(id), [...(byOwner.get(ownerOf(id)) ?? []), id]);
  for (const [owner, ownerIds] of byOwner) {
    const { error } = await supabase
      .from('items')
      .delete()
      .eq('user_id', owner)
      .in('id', ownerIds);
    if (error) throw error;
  }
}

/** IDs deleted on any device. Applied locally so deletions propagate. */
export async function cloudLoadTombstones(): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from('deleted_items')
    .select('id');
  if (error) throw error;
  return (data as Array<{ id: string }>).map((r) => r.id);
}
