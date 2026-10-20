/**
 * Household rules on the phone — pure, so they run under `npm test`. They
 * mirror the database's access rules (supabase/migrations/004_households.sql),
 * so the app never offers something the server would refuse; a refused
 * change would otherwise sit in the sync queue and fail every sync.
 */

import type { SinceItem, CompletionEvent } from '../../types';

export interface Member {
  userId: string;
  displayName: string;
  role: 'owner' | 'member';
}

export interface Household {
  id: string;
  name: string;
  members: Member[];
}

/** What the phone knows about the signed-in account's household. */
export interface HouseholdState {
  /** The signed-in account, or null when signed out. */
  userId: string | null;
  household: Household | null;
  /** Items this member has muted, as muteKey()s. */
  mutes: string[];
}

export const NO_HOUSEHOLD: HouseholdState = { userId: null, household: null, mutes: [] };

export function isShared(item: SinceItem): boolean {
  return typeof item.householdId === 'string' && item.householdId.length > 0;
}

/** True when the item belongs to this phone's account (items made here have no ownerId). */
export function isMine(item: SinceItem, me: string | null): boolean {
  return !item.ownerId || item.ownerId === me;
}

export function isHouseholdOwner(state: HouseholdState): boolean {
  return !!state.household?.members.some((m) => m.userId === state.userId && m.role === 'owner');
}

/** Only the person who added an item can change who it's for. */
export function canChangeSharing(item: SinceItem, state: HouseholdState): boolean {
  return state.household !== null && isMine(item, state.userId);
}

/** Its creator can delete an item, and the household's owner can delete a shared one. */
export function canDelete(item: SinceItem, state: HouseholdState): boolean {
  if (isMine(item, state.userId)) return true;
  return isShared(item) && item.householdId === state.household?.id && isHouseholdOwner(state);
}

export function muteKey(item: Pick<SinceItem, 'id' | 'ownerId'>, me: string | null): string {
  return `${item.ownerId ?? me ?? ''}/${item.id}`;
}

export function isMuted(item: SinceItem, state: HouseholdState): boolean {
  return isShared(item) && state.mutes.includes(muteKey(item, state.userId));
}

export type ListFilter = 'all' | 'mine' | 'household';

export function filterItems<T extends SinceItem>(items: T[], filter: ListFilter): T[] {
  if (filter === 'all') return items;
  return items.filter((i) => (filter === 'household' ? isShared(i) : !isShared(i)));
}

/** "Done by Alex" on an entry of a shared item, or null when there's nothing to say. */
export function doneBy(item: SinceItem, entry: CompletionEvent, state: HouseholdState): string | null {
  if (!isShared(item) || !state.household) return null;
  // Not synced yet: recorded on this phone
  const who = entry.createdBy ?? state.userId;
  const member = state.household.members.find((m) => m.userId === who);
  return member ? `Done by ${member.displayName}` : null;
}

/**
 * After leaving a household (or being removed, or the household being
 * deleted): the shared items this phone held are no longer this account's to
 * see, except its own items, which the server made personal or handed to the
 * household. What stays: everything not shared with that household.
 */
export function afterLeaving(items: SinceItem[], householdId: string): SinceItem[] {
  return items.filter((i) => i.householdId !== householdId);
}

/**
 * Shared items this phone holds that the household no longer shares (their
 * creator made them personal again), so they go from this phone. Items this
 * account owns are never dropped: they're still its own.
 */
export function noLongerShared(
  items: SinceItem[],
  householdId: string,
  sharedKeys: Set<string>,
  me: string,
): string[] {
  return items
    .filter((i) => i.householdId === householdId && i.ownerId && i.ownerId !== me)
    .filter((i) => !sharedKeys.has(`${i.ownerId}/${i.id}`))
    .map((i) => i.id);
}

export interface HouseholdChange {
  /** A household this account is no longer in: its items go from this phone. */
  left: string | null;
  /** Pull everything again: joining brings in items shared before this phone's last pull. */
  pullEverything: boolean;
}

/** What a fresh look at the household means for this phone. */
export function householdChange(
  before: HouseholdState,
  userId: string,
  now: Household | null,
): HouseholdChange {
  // A cached household from another account means nothing for this one
  const was = before.userId === userId ? before.household?.id ?? null : null;
  const is = now?.id ?? null;
  if (was === is) return { left: null, pullEverything: false };
  return { left: was, pullEverything: true };
}
