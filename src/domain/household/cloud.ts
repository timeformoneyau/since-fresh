/**
 * Supabase calls for households (migration 004). Transport only: what the
 * results mean for the phone is decided in service.ts. Membership only
 * changes through the database's functions, never by writing the tables.
 */

import { requireSupabase } from '../../lib/supabase';
import type { Household, Member } from './rules';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** The signed-in account's household with its members, and its mutes. */
export async function fetchHousehold(): Promise<{ household: Household | null; mutes: string[] }> {
  const supabase = requireSupabase();
  const hid = await rpc<string | null>('my_household_id');

  const { data: muteRows, error: muteErr } = await supabase.from('item_mutes').select('owner_id, item_id');
  if (muteErr) throw muteErr;
  const mutes = ((muteRows ?? []) as Array<{ owner_id: string; item_id: string }>).map(
    (m) => `${m.owner_id}/${m.item_id}`,
  );

  if (!hid) return { household: null, mutes };

  const [{ data: h, error: hErr }, { data: rows, error: mErr }] = await Promise.all([
    supabase.from('households').select('id, name').eq('id', hid).single(),
    supabase.from('household_members').select('user_id, display_name, role, joined_at').eq('household_id', hid)
      .order('joined_at'),
  ]);
  if (hErr) throw hErr;
  if (mErr) throw mErr;
  const members: Member[] = ((rows ?? []) as Array<{ user_id: string; display_name: string; role: Member['role'] }>)
    .map((r) => ({ userId: r.user_id, displayName: r.display_name, role: r.role }));
  return { household: { id: (h as { id: string }).id, name: (h as { name: string }).name, members }, mutes };
}

export const createHousehold = (name: string, myName: string) =>
  rpc<string>('create_household', { household_name: name, my_name: myName });
export const createInvite = () => rpc<string>('create_invite');
/** The household id (as text or JSON); see service.ts for an error body returned as data. */
export const joinHousehold = (code: string, myName: string) =>
  rpc<unknown>('join_household', { invite_code: code, my_name: myName });
export const revokeInvite = (code: string) => rpc<void>('revoke_invite', { invite_code: code });

/**
 * The household's codes still waiting to be used, newest first. Only the
 * owner can read them (household_invites_select, 004_households.sql).
 */
export async function fetchActiveInvites(householdId: string): Promise<Array<{ code: string; expiresAt: string }>> {
  const { data, error } = await requireSupabase()
    .from('household_invites')
    .select('code, expires_at')
    .eq('household_id', householdId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<{ code: string; expires_at: string }>).map((r) => ({ code: r.code, expiresAt: r.expires_at }));
}

export const leaveHousehold = () => rpc<void>('leave_household');
export const removeMember = (userId: string) => rpc<void>('remove_member', { member: userId });
export const transferOwnership = (userId: string) => rpc<void>('transfer_ownership', { new_owner: userId });
export const deleteHousehold = () => rpc<void>('delete_household');

export async function setMute(ownerId: string, itemId: string, muted: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { error } = muted
    ? await supabase.from('item_mutes').upsert({ owner_id: ownerId, item_id: itemId }, { onConflict: 'user_id,owner_id,item_id', ignoreDuplicates: true })
    : await supabase.from('item_mutes').delete().eq('owner_id', ownerId).eq('item_id', itemId);
  if (error) throw error;
}

/** Every item shared with the household, as "owner/id" (to spot ones since made personal again). */
export async function fetchSharedItemKeys(householdId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await requireSupabase()
      .from('items')
      .select('user_id, id')
      .eq('household_id', householdId)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ user_id: string; id: string }>;
    rows.forEach((r) => keys.add(`${r.user_id}/${r.id}`));
    if (rows.length < 1000) return keys;
  }
}
