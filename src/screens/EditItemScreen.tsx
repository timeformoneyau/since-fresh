import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, SinceItem } from '../types';
import {
  getDerivedItemById,
  updateItem,
  deleteItem,
  restoreDeletedItem,
  HistoryError,
} from '../domain/items/service';
import { palette, fonts, TAP } from '../theme/tokens';
import ItemForm, { ItemFormValues } from '../components/ItemForm';
import { useToast } from '../components/Toast';
import { useHousehold } from '../components/useHousehold';
import { needsReminderExplanation } from '../notifications/permissionFlow';
import {
  canChangeSharing,
  canDelete,
  canChooseWhoLooksAfter,
  lookAfterChoices,
  lookedAfterBy,
} from '../domain/household/service';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Edit'>;
type Route = RouteProp<RootStackParamList, 'Edit'>;

export default function EditItemScreen() {
  const navigation = useNavigation<Nav>();
  const showToast = useToast();
  const { itemId } = useRoute<Route>().params;
  const [initial, setInitial] = useState<ItemFormValues | null>(null);
  const [item, setItem] = useState<SinceItem | null>(null);
  const household = useHousehold();

  useEffect(() => {
    (async () => {
      const derived = await getDerivedItemById(itemId);
      if (!derived) { navigation.goBack(); return; }
      setItem(derived);
      setInitial({
        name: derived.name,
        category: derived.category,
        lastDoneDate: derived.lastDoneDate,
        repeatValue: derived.repeatValue,
        repeatUnit: derived.repeatUnit,
        shared: !!derived.householdId,
        lookedAfterBy: lookedAfterBy(derived),
        ...(typeof derived.dueDate === 'string' ? { dueDate: derived.dueDate } : {}),
      });
    })();
  }, [itemId, navigation]);

  const sharing = item && household.household && canChangeSharing(item, household) ? household.household : null;
  // Any member, on a shared item; its creator also while making it shared
  const offerLookAfter = !!item && (canChooseWhoLooksAfter(item, household) || sharing !== null);

  async function handleSave({ shared, dueDate, ...values }: ItemFormValues) {
    try {
      // Switching between Repeats and Once off keeps the history; a new date
      // edits the latest entry (service.ts, updateItem). A date item's due
      // date can change; how it's tracked can't (v1)
      await updateItem(itemId, {
        ...values,
        ...(dueDate ? { dueDate } : {}),
        ...(sharing && shared !== undefined ? { householdId: shared ? sharing.id : null } : {}),
      });
    } catch (e) {
      // The latest entry can't move before the one under it
      if (e instanceof HistoryError) {
        showToast({ message: e.message });
        return;
      }
      throw e;
    }
    // Made repeating, before reminders were ever explained
    if (await needsReminderExplanation(values.repeatValue !== null || !!dueDate).catch(() => false)) {
      navigation.replace('RemindersPermission');
      return;
    }
    navigation.goBack();
  }

  async function handleDelete() {
    const removed = await deleteItem(itemId);
    // Back to the list: the item screen for this item would no longer exist
    navigation.popToTop();
    if (!removed) return;
    showToast({
      message: `${removed.name} deleted`,
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await restoreDeletedItem(removed);
        } catch {
          showToast({ message: "Couldn't undo. Please try again." });
        }
      },
    });
  }

  if (!initial) return null;

  return (
    <ItemForm
      prefix="edit"
      title="Edit"
      initial={initial}
      submitLabel="Save changes"
      dateHelp="This is your latest entry. Older ones are on the item screen."
      onSubmit={handleSave}
      trackLocked
      householdName={sharing?.name}
      lookAfter={offerLookAfter ? { choices: lookAfterChoices(household), me: household.userId } : undefined}
      footer={item && !canDelete(item, household) ? undefined : (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDelete}
          testID="edit-delete-button"
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  deleteBtn: { minHeight: TAP, alignItems: 'center', justifyContent: 'center' },
  deleteText: { fontFamily: fonts.bold, fontSize: 15, color: palette.danger },
});
