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

interface ItemRow {
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
}

function rowToItem(row: ItemRow): CloudItem {
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
  };
}

function entryToRow(e: EntryRow, userId: string): EntryDbRow {
  return {
    user_id: userId,
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

function itemToRow(item: SinceItem, userId: string): ItemRow {
  return {
    id: item.id,
    user_id: userId,
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
  return rows.map(rowToItem);
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
      .select('item_id, id, date, note, created_at, deleted_at, server_updated_at');
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

  const byItem = new Map<string, string[]>();
  for (const r of softDelete) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r.entryId]);
  for (const [itemId, ids] of byItem) {
    const { error } = await supabase
      .from('completion_events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .in('id', ids)
      .is('deleted_at', null);
    if (error) throw error;
  }
}

export async function cloudUpsertMany(items: SinceItem[]): Promise<void> {
  if (items.length === 0) return;
  const userId = await currentUserId();
  const rows = items.map((item) => itemToRow(item, userId));
  // The key is (user_id, id): two accounts may hold the same item id.
  const { error } = await requireSupabase()
    .from('items')
    .upsert(rows, { onConflict: 'user_id,id' });
  if (error) throw error;
}

/**
 * Delete items and record tombstones, so the deletion survives a pull on
 * another device that still holds the item.
 */
export async function cloudDeleteMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = requireSupabase();
  const userId = await currentUserId();

  const { error: tombErr } = await supabase
    .from('deleted_items')
    .upsert(ids.map((id) => ({ id, user_id: userId })), { onConflict: 'id,user_id' });
  if (tombErr) throw tombErr;

  // Scoped to this account explicitly, not only through RLS: ids are unique
  // per account, not globally.
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('user_id', userId)
    .in('id', ids);
  if (error) throw error;
}

/** IDs deleted on any device. Applied locally so deletions propagate. */
export async function cloudLoadTombstones(): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from('deleted_items')
    .select('id');
  if (error) throw error;
  return (data as Array<{ id: string }>).map((r) => r.id);
}
