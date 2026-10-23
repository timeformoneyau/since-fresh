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

/** A new invite code, shown as XXXX-XXXX. */
export async function createInvite(): Promise<string> {
  const code = await cloud.createInvite();
  return `${code.slice(0, 4)}-${code.slice(4)}`;
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
