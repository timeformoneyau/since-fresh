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

export type { Household, Member, HouseholdState, ListFilter } from './rules';
export {
  isShared,
  isMine,
  isMuted,
  isHouseholdOwner,
  canChangeSharing,
  canDelete,
  filterItems,
  doneBy,
} from './rules';
export { onHouseholdChanged };

export const getHouseholdState = loadHouseholdState;

/** Household and invite errors the database raises, in plain words. */
export function householdErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  // Our own functions raise their message for these (004_households.sql)
  if ((e.code === 'P0001' || e.code === 'P0002' || e.code === '42501') && typeof e.message === 'string') {
    return e.message;
  }
  if (e.code === 'PGRST202' || e.code === '42883') {
    return "Households aren't set up on the server yet.";
  }
  return "Couldn't reach the server. Check your connection and try again.";
}

export async function createHousehold(name: string, myName: string): Promise<void> {
  await cloud.createHousehold(name.trim(), myName.trim());
}

export async function joinHousehold(code: string, myName: string): Promise<void> {
  await cloud.joinHousehold(code.trim(), myName.trim());
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
