/**
 * The household as last seen from the cloud, kept on the phone so screens and
 * reminders work offline. Refreshed by service.ts; cleared with the rest of
 * the account's local data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HouseholdState, NO_HOUSEHOLD } from './rules';

const HOUSEHOLD_KEY = '@since_household_v1';

type Listener = (state: HouseholdState) => void;
const listeners = new Set<Listener>();

export async function loadHouseholdState(): Promise<HouseholdState> {
  try {
    const raw = await AsyncStorage.getItem(HOUSEHOLD_KEY);
    if (!raw) return NO_HOUSEHOLD;
    const s = JSON.parse(raw) as Partial<HouseholdState>;
    return {
      userId: typeof s.userId === 'string' ? s.userId : null,
      household: s.household && typeof s.household.id === 'string' ? s.household : null,
      mutes: Array.isArray(s.mutes) ? s.mutes.filter((m): m is string => typeof m === 'string') : [],
    };
  } catch {
    return NO_HOUSEHOLD;
  }
}

export async function saveHouseholdState(state: HouseholdState): Promise<void> {
  await AsyncStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(state));
  listeners.forEach((l) => l(state));
}

export async function clearHouseholdState(): Promise<void> {
  await AsyncStorage.removeItem(HOUSEHOLD_KEY);
  listeners.forEach((l) => l(NO_HOUSEHOLD));
}

/** Subscribe to changes (screens showing household parts). Returns an unsubscribe function. */
export function onHouseholdChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
