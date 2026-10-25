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
        repeatValue: starter?.until ? (starter.until.repeat ? 1 : null) : usual?.repeatValue ?? 30,
        repeatUnit: starter?.until ? (starter.until.repeat ? 'years' : null) : usual?.repeatUnit ?? 'days',
        // A starter like car rego opens on "Until it's due", asking the date
        ...(starter?.until ? { dueDate: null } : {}),
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
        // The first item with reminders (repeating, or due on a date) is when they start to matter
        const reminded = values.repeatValue !== null || !!values.dueDate;
        if (await needsReminderExplanation(reminded).catch(() => false)) {
          navigation.replace('RemindersPermission');
          return;
        }
        navigation.goBack();
      }}
    />
  );
}
