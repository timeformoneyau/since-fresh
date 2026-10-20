import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getHouseholdState,
  onHouseholdChanged,
  type HouseholdState,
} from '../domain/household/service';

const NONE: HouseholdState = { userId: null, household: null, mutes: [] };

/** The household as last known on this phone; updates when it changes. */
export function useHousehold(): HouseholdState {
  const [state, setState] = useState<HouseholdState>(NONE);

  useFocusEffect(
    useCallback(() => {
      getHouseholdState().then(setState).catch(() => {});
    }, []),
  );
  useEffect(() => onHouseholdChanged(setState), []);

  return state;
}
