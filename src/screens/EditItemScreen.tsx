import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, RepeatUnit } from '../types';
import { getDerivedItemById, updateItem, deleteItem, restoreDeletedItem } from '../domain/items/service';
import { formatDisplay, parseDate, todayString } from '../utils/dateUtils';
import { colours } from '../components/colours';
import DatePickerModal from '../components/DatePickerModal';
import CategoryPicker from '../components/CategoryPicker';
import { useToast } from '../components/Toast';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Edit'>;
type Route = RouteProp<RootStackParamList, 'Edit'>;

const REPEAT_UNITS: RepeatUnit[] = ['days', 'weeks', 'months', 'years'];

export default function EditItemScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const showToast = useToast();
  const route = useRoute<Route>();
  const { itemId } = route.params;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Other');
  const [lastDoneDate, setLastDoneDate] = useState(todayString());
  const [repeatValue, setRepeatValue] = useState('');
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>('months');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNameHint, setShowNameHint] = useState(false);

  useEffect(() => {
    (async () => {
      const derived = await getDerivedItemById(itemId);
      if (!derived) { navigation.goBack(); return; }
      setName(derived.name);
      setCategory(derived.category);
      setLastDoneDate(derived.lastDoneDate);
      setRepeatValue(derived.repeatValue ? String(derived.repeatValue) : '');
      setRepeatUnit(derived.repeatUnit ?? 'months');
      setLoading(false);
    })();
  }, [itemId]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setShowNameHint(true);
      return;
    }

    const rv = repeatValue ? parseInt(repeatValue, 10) : null;
    const hasRepeat = rv !== null && rv > 0;

    await updateItem(itemId, {
      name: trimmed,
      category,
      lastDoneDate,
      repeatValue: hasRepeat ? rv : null,
      repeatUnit: hasRepeat ? repeatUnit : null,
    });

    navigation.goBack();
  }

  async function handleDelete() {
    const removed = await deleteItem(itemId);
    // Back to the list: a History screen for this item would no longer exist
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

  if (loading) return null;

  const canSave = name.trim().length > 0;
  const hasRepeatValue = repeatValue !== '';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colours.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.textInput}
            testID="edit-name-input"
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
        </View>

        {/* Last done */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Last done</Text>
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={styles.rowButtonText}>
              {formatDisplay(parseDate(lastDoneDate))}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Category */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Category</Text>
          <TouchableOpacity
            style={styles.rowButton}
            onPress={() => setShowCategoryPicker(true)}
          >
            <Text style={styles.rowButtonText}>{category}</Text>
          </TouchableOpacity>
        </View>

        {/* Repeat every */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Repeat every (optional)</Text>
          <View style={styles.repeatRow}>
            <TextInput
              style={styles.repeatInput}
              testID="edit-repeat-input"
              placeholder="No repeat"
              placeholderTextColor={colours.textMuted}
              value={repeatValue}
              onChangeText={(t) => setRepeatValue(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={4}
            />
            <View style={styles.unitRow}>
              {REPEAT_UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  testID={`edit-unit-${u}`}
                  style={[
                    styles.unitBtn,
                    hasRepeatValue && repeatUnit === u && styles.unitBtnActive,
                  ]}
                  onPress={() => setRepeatUnit(u)}
                >
                  <Text
                    style={[
                      styles.unitBtnText,
                      hasRepeatValue && repeatUnit === u && styles.unitBtnTextActive,
                    ]}
                  >
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!hasRepeatValue && <Text style={styles.hint}>Leave blank to just keep track of when you last did it.</Text>}
          </View>
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          testID="edit-save-button"
          // Stays tappable so it can explain why it can't save. Explicit
          // disabled={false} is needed: TouchableOpacity otherwise treats
          // accessibilityState.disabled as disabled and swallows the tap.
          disabled={false}
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={styles.saveBtnText}>Save changes</Text>
        </TouchableOpacity>
        {showNameHint && !canSave && (
          <Text style={styles.saveHint} testID="edit-save-hint">Add a name to save</Text>
        )}

        {/* Delete */}
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} testID="edit-delete-button">
          <Text style={styles.deleteBtnText}>Delete this item</Text>
        </TouchableOpacity>
      </ScrollView>

      {showDatePicker && (
        <DatePickerModal
          value={lastDoneDate}
          onConfirm={(d) => { setLastDoneDate(d); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      )}

      {showCategoryPicker && (
        <CategoryPicker
          value={category}
          onSelect={(c) => { setCategory(c); setShowCategoryPicker(false); }}
          onCancel={() => setShowCategoryPicker(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
  fieldGroup: { marginBottom: 20 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  textInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    fontSize: 15,
    color: colours.textPrimary,
  },
  rowButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
  },
  rowButtonText: { fontSize: 15, color: colours.textPrimary },
  repeatRow: { marginBottom: 8 },
  repeatInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    fontSize: 15,
    color: colours.textPrimary,
    marginBottom: 6,
  },
  unitRow: { flexDirection: 'row' },
  unitBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
    marginRight: 6,
  },
  unitBtnActive: { backgroundColor: colours.textPrimary, borderColor: colours.textPrimary },
  unitBtnText: { fontSize: 13, color: colours.textSecondary },
  unitBtnTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  saveBtnDisabled: { opacity: 0.35 },
  hint: { fontSize: 12, color: colours.textMuted, marginTop: 8 },
  saveHint: { fontSize: 13, color: colours.textSecondary, textAlign: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: 14, color: colours.destructive },
});
