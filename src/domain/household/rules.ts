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

// ─── Who looks after a shared item (005_looked_after_by.sql) ────────────────
// Coordination, not permission: any member may choose anyone in the
// household, or Anyone (null). The server refuses a non-member and a value on
// an item that isn't shared, so neither is ever offered or queued here.

/** Who looks after the item, or null for Anyone. A personal item never has anyone. */
export function lookedAfterBy(item: SinceItem): string | null {
  return isShared(item) && typeof item.lookedAfterBy === 'string' && item.lookedAfterBy.length > 0
    ? item.lookedAfterBy
    : null;
}

/** Any member can say who looks after a shared item of their household. */
export function canChooseWhoLooksAfter(item: SinceItem, state: HouseholdState): boolean {
  return state.household !== null && isShared(item) && item.householdId === state.household.id;
}

/** Whether the server would accept `person` for this item: Anyone, or a member of its household. */
export function canLookAfter(item: SinceItem, person: string | null, state: HouseholdState): boolean {
  if (person === null) return true;
  return canChooseWhoLooksAfter(item, state) && state.household!.members.some((m) => m.userId === person);
}

export interface LookAfterChoice {
  /** null is Anyone. */
  userId: string | null;
  label: string;
}

/** "Who looks after this?": Anyone, You, then each other member by name, in joining order. */
export function lookAfterChoices(state: HouseholdState): LookAfterChoice[] {
  const others = (state.household?.members ?? []).filter((m) => m.userId !== state.userId);
  return [
    { userId: null, label: LOOK_AFTER_COPY.anyone },
    ...(state.userId && state.household?.members.some((m) => m.userId === state.userId)
      ? [{ userId: state.userId, label: LOOK_AFTER_COPY.you }]
      : []),
    ...others.map((m) => ({ userId: m.userId, label: m.displayName })),
  ];
}

export const LOOK_AFTER_COPY = {
  question: 'Who looks after this?',
  anyone: 'Anyone',
  you: 'You',
  takeIt: "I'll look after this",
  youLookAfter: 'You look after this',
  theyLookAfter: (name: string) => `${name} looks after this`,
} as const;

/** "You" or the member's name, or null when nobody (that this phone knows) is chosen. */
export function lookedAfterName(item: SinceItem, state: HouseholdState): string | null {
  const who = lookedAfterBy(item);
  if (!who) return null;
  if (who === state.userId) return LOOK_AFTER_COPY.you;
  return state.household?.members.find((m) => m.userId === who)?.displayName ?? null;
}

/**
 * Items whose chosen person the server would no longer accept: they left the
 * household (the server has already cleared it), or the item isn't shared
 * any more. Returned with Anyone, so a change still queued on this phone
 * never sends a person the server would refuse.
 */
export function withoutStaleLookedAfter(items: SinceItem[], household: Household | null): SinceItem[] {
  const members = new Set(household?.members.map((m) => m.userId) ?? []);
  return items.flatMap((i) => {
    if (i.lookedAfterBy === undefined || i.lookedAfterBy === null) return [];
    const ok = isShared(i) && i.householdId === household?.id && members.has(i.lookedAfterBy);
    return ok ? [] : [{ ...i, lookedAfterBy: null }];
  });
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
