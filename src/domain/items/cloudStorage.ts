/**
 * Supabase row mapping for items.
 *
 * This module is transport only — it does not decide *when* to sync. That
 * belongs to domain/sync/engine.ts. Every function here assumes the caller
 * has confirmed cloud sync is configured and the user is authenticated, and
 * will throw otherwise; the sync engine treats those throws as "stay offline".
 */

import { SinceItem, CompletionEvent, RepeatUnit, ItemSource } from '../../types';
import { requireSupabase } from '../../lib/supabase';

interface ItemRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  last_done_date: string;
  history: unknown;
  repeat_value: number | null;
  repeat_unit: string | null;
  expiry_date: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: ItemRow): SinceItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    lastDoneDate: row.last_done_date,
    history: Array.isArray(row.history) ? (row.history as CompletionEvent[]) : [],
    repeatValue: row.repeat_value,
    repeatUnit: row.repeat_unit as RepeatUnit | null,
    expiryDate: row.expiry_date,
    source: (row.source as ItemSource | null) ?? 'manual',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    expiry_date: item.expiryDate,
    source: item.source,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

export async function currentUserId(): Promise<string> {
  const { data: { user } } = await requireSupabase().auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function cloudLoadItems(): Promise<SinceItem[]> {
  const { data, error } = await requireSupabase()
    .from('items')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ItemRow[]).map(rowToItem);
}

export async function cloudUpsertMany(items: SinceItem[]): Promise<void> {
  if (items.length === 0) return;
  const userId = await currentUserId();
  const rows = items.map((item) => itemToRow(item, userId));
  const { error } = await requireSupabase().from('items').upsert(rows);
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
    .upsert(ids.map((id) => ({ id, user_id: userId })));
  if (tombErr) throw tombErr;

  const { error } = await supabase.from('items').delete().in('id', ids);
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
