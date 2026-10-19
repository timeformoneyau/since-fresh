import React, { useEffect, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, RepeatUnit } from '../types';
import { createItem } from '../domain/items/service';
import { todayString, formatDisplay, parseDate } from '../utils/dateUtils';
import { getSuggestion } from '../utils/suggestions';
import { colours, fonts } from '../theme/tokens';
import DatePickerModal from '../components/DatePickerModal';
import CategoryPicker from '../components/CategoryPicker';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Add'>;

const REPEAT_UNITS: RepeatUnit[] = ['days', 'weeks', 'months', 'years'];

export default function AddItemScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const nameRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Other');
  const [lastDoneDate, setLastDoneDate] = useState(todayString());
  const [repeatValue, setRepeatValue] = useState('');
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>('months');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [suggestion, setSuggestion] = useState<{ repeatValue: number; repeatUnit: RepeatUnit } | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [showNameHint, setShowNameHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setSuggestion(getSuggestion(name));
    setSuggestionApplied(false);
  }, [name]);

  function applySuggestion() {
    if (!suggestion) return;
    setRepeatValue(String(suggestion.repeatValue));
    setRepeatUnit(suggestion.repeatUnit);
    setSuggestionApplied(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setShowNameHint(true);
      return;
    }

    const rv = repeatValue ? parseInt(repeatValue, 10) : null;
    const hasRepeat = rv !== null && rv > 0;

    await createItem({
      name: trimmed,
      category,
      lastDoneDate,
      repeatValue: hasRepeat ? rv : null,
      repeatUnit: hasRepeat ? repeatUnit : null,
    });

    navigation.goBack();
  }

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
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            ref={nameRef}
            style={styles.nameInput}
            testID="add-name-input"
            placeholder="What have you done?"
            placeholderTextColor={colours.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
        </View>

        {/* Suggestion banner */}
        {suggestion && !suggestionApplied && repeatValue === '' && (
          <TouchableOpacity style={styles.suggestionBanner} onPress={applySuggestion}>
            <Text style={styles.suggestionText}>
              Suggested: every {suggestion.repeatValue} {suggestion.repeatUnit}
            </Text>
            <Text style={styles.suggestionApply}>Apply</Text>
          </TouchableOpacity>
        )}

        {/* Last done */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Last done</Text>
          <TouchableOpacity
            style={styles.rowButton}
            testID="add-last-done-button"
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
          <TextInput
            style={styles.repeatInput}
            testID="add-repeat-input"
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
                style={[styles.unitBtn, hasRepeatValue && repeatUnit === u && styles.unitBtnActive]}
                onPress={() => setRepeatUnit(u)}
                testID={`add-unit-${u}`}
              >
                <Text style={[styles.unitBtnText, hasRepeatValue && repeatUnit === u && styles.unitBtnTextActive]}>
                  {u}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!hasRepeatValue && <Text style={styles.hint}>Leave blank to just keep track of when you last did it.</Text>}
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          testID="add-save-button"
          // Stays tappable so it can explain why it can't save. Explicit
          // disabled={false} is needed: TouchableOpacity otherwise treats
          // accessibilityState.disabled as disabled and swallows the tap.
          disabled={false}
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={styles.saveBtnText}>Track this</Text>
        </TouchableOpacity>
        {showNameHint && !canSave && (
          <Text style={styles.saveHint} testID="add-save-hint">Add a name to save</Text>
        )}
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
  field: { marginBottom: 8 },
  nameInput: {
    fontSize: 24,
    fontFamily: fonts.semibold,
    color: colours.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: colours.border,
    marginBottom: 16,
  },
  suggestionBanner: {
    backgroundColor: '#FFF8EE',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F0D9B0',
  },
  suggestionText: { fontFamily: fonts.regular, fontSize: 13, color: '#7A5C2A' },
  suggestionApply: { fontSize: 13, fontFamily: fonts.semibold, color: '#C8842A' },
  fieldGroup: { marginBottom: 20 },
  label: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  rowButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
  },
  rowButtonText: { fontFamily: fonts.regular, fontSize: 15, color: colours.textPrimary },
  repeatInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    fontFamily: fonts.regular, fontSize: 15,
    color: colours.textPrimary,
    marginBottom: 8,
  },
  unitRow: { flexDirection: 'row', marginTop: 2 },
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
  unitBtnText: { fontFamily: fonts.regular, fontSize: 13, color: colours.textSecondary },
  unitBtnTextActive: { color: '#fff', fontFamily: fonts.semibold },
  saveBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnDisabled: { opacity: 0.35 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colours.textMuted, marginTop: 8 },
  saveHint: { fontFamily: fonts.regular, fontSize: 13, color: colours.textSecondary, textAlign: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.semibold },
});
