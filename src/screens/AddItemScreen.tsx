import React from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { createItem } from '../domain/items/service';
import { todayString } from '../utils/dateUtils';
import ItemForm from '../components/ItemForm';
import { useHousehold } from '../components/useHousehold';
import { getSuggestion } from '../utils/suggestions';
import { lookAfterChoices } from '../domain/household/service';
import { needsReminderExplanation } from '../notifications/permissionFlow';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Add'>;

export default function AddItemScreen() {
  const navigation = useNavigation<Nav>();
  const state = useHousehold();
  const { household } = state;
  // From a starter: its name, category and usual gap, all still editable
  const starter = useRoute<RouteProp<RootStackParamList, 'Add'>>().params;
  const usual = starter ? getSuggestion(starter.name) : null;

  return (
    <ItemForm
      prefix="add"
      title="Track something"
      initial={{
        name: starter?.name ?? '',
        category: starter?.category ?? 'Other',
        lastDoneDate: todayString(),
        repeatValue: usual?.repeatValue ?? 30,
        repeatUnit: usual?.repeatUnit ?? 'days',
      }}
      submitLabel="Track this"
      dateHelp="This becomes the first entry in its history. You can add or edit past entries later."
      suggestFromName
      autoFocusName={!starter}
      householdName={household?.name}
      lookAfter={household ? { choices: lookAfterChoices(state), me: state.userId } : undefined}
      onSubmit={async ({ shared, lookedAfterBy, ...values }) => {
        const householdId = shared && household ? household.id : null;
        await createItem({ ...values, householdId, lookedAfterBy: householdId ? lookedAfterBy ?? null : null });
        // The first repeating item is when reminders start to matter
        if (await needsReminderExplanation(values.repeatValue !== null).catch(() => false)) {
          navigation.replace('RemindersPermission');
          return;
        }
        navigation.goBack();
      }}
    />
  );
}
