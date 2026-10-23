/**
 * Households (sync plan, PR 6): the one entry point screens use.
 *
 * Membership changes go straight to the cloud (they need everyone to agree,
 * so they can't be made offline) and screens sync afterwards. The sync engine
 * then refreshes the household before each sync (sync/engine.ts) and applies
 * what changed to the list: leaving removes the household's items from this
 * phone, joining pulls them in. Mutes are kept per member.
 */

import * as cloud from './cloud';
import { loadHouseholdState, saveHouseholdState, onHouseholdChanged } from './store';
import { HouseholdState, muteKey, isShared } from './rules';
import type { SinceItem } from '../../types';

export type { Household, Member, HouseholdState, ListFilter, LookAfterChoice } from './rules';
export {
  isShared,
  isMine,
  isMuted,
  isHouseholdOwner,
  canChangeSharing,
  canDelete,
  filterItems,
  doneBy,
  canChooseWhoLooksAfter,
  lookAfterChoices,
  lookedAfterBy,
  lookedAfterName,
  LOOK_AFTER_COPY,
} from './rules';
export { onHouseholdChanged };

export const getHouseholdState = loadHouseholdState;

export { HOUSEHOLD_COPY, householdErrorMessage, joinResultError } from './errors';
import { joinResultError } from './errors';

export async function createHousehold(name: string, myName: string): Promise<void> {
  await cloud.createHousehold(name.trim(), myName.trim());
}

export async function joinHousehold(code: string, myName: string): Promise<void> {
  const refused = joinResultError(await cloud.joinHousehold(code.trim(), myName.trim()));
  if (refused) throw refused;
}

export interface Invite {
  /** Shown as XXXX-XXXX. */
  code: string;
  expiresAt: string;
}

const shown = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The code people can use now (the newest), or null. Owner only. */
export async function getActiveInvite(householdId: string): Promise<Invite | null> {
  const [newest] = await cloud.fetchActiveInvites(householdId);
  return newest ? { code: shown(newest.code), expiresAt: newest.expiresAt } : null;
}

/**
 * "Invite someone": the code already waiting, if there is one, so each tap
 * doesn't make another; otherwise a new one (7 days).
 */
export async function inviteCode(householdId: string): Promise<Invite> {
  const active = await getActiveInvite(householdId);
  if (active) return active;
  const code = await cloud.createInvite();
  // Read back for the server's expiry; codes last 7 days (004_households.sql)
  return (await getActiveInvite(householdId).catch(() => null))
    ?? { code: shown(code), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
}

/** Stop every code still waiting, so none of them can be used to join. */
export async function revokeInvites(householdId: string): Promise<void> {
  for (const { code } of await cloud.fetchActiveInvites(householdId)) await cloud.revokeInvite(code);
}

/** Stop the codes waiting and make a new one. */
export async function replaceInvite(householdId: string): Promise<Invite> {
  await revokeInvites(householdId);
  return inviteCode(householdId);
}

export const leaveHousehold = () => cloud.leaveHousehold();
export const removeMember = (userId: string) => cloud.removeMember(userId);
export const transferOwnership = (userId: string) => cloud.transferOwnership(userId);
export const deleteHousehold = () => cloud.deleteHousehold();

/**
 * Turn "Remind me about this" on or off for a shared item, for this member
 * only. Saved in the cloud, so it follows the member to another phone.
 */
export async function setRemindMe(item: SinceItem, remind: boolean): Promise<HouseholdState> {
  const state = await loadHouseholdState();
  if (!isShared(item) || !state.userId) return state;
  const key = muteKey(item, state.userId);
  await cloud.setMute(item.ownerId ?? state.userId, item.id, !remind);
  const mutes = remind ? state.mutes.filter((m) => m !== key) : [...new Set([...state.mutes, key])];
  const next = { ...state, mutes };
  await saveHouseholdState(next);
  return next;
}
