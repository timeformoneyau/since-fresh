import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, RepeatUnit, ItemSource } from '../types';
import { createItem } from '../domain/items/service';
import { todayString, formatDisplay, parseDate } from '../utils/dateUtils';
import { getSuggestion } from '../utils/suggestions';
import { colours } from '../components/colours';
import DatePickerModal from '../components/DatePickerModal';
import CategoryPicker from '../components/CategoryPicker';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Add'>;
type AddRoute = RouteProp<RootStackParamList, 'Add'>;

const REPEAT_UNITS: RepeatUnit[] = ['days', 'weeks', 'months', 'years'];

export default function AddItemScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<AddRoute>();
  const prefill = route.params?.prefill;
  const nameRef = useRef<TextInput>(null);

  const [name, setName] = useState(prefill?.name ?? '');
  const [category, setCategory] = useState(prefill?.category ?? 'Other');
  const [lastDoneDate, setLastDoneDate] = useState(todayString());
  const [repeatValue, setRepeatValue] = useState('');
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>('months');
  const [expiryDate, setExpiryDate] = useState<string | null>(prefill?.expiryDate ?? null);
  const [source] = useState<ItemSource>(prefill?.source ?? 'manual');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [suggestion, setSuggestion] = useState<{ repeatValue: number; repeatUnit: RepeatUnit } | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);

  useEffect(() => {
    if (prefill) return; // don't steal focus from a prefilled, ready-to-review form
    const timer = setTimeout(() => nameRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [prefill]);

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
    if (!trimmed) return;

    const rv = repeatValue ? parseInt(repeatValue, 10) : null;
    const hasRepeat = rv !== null && rv > 0;

    await createItem({
      name: trimmed,
      category,
      lastDoneDate,
      // A scanned expiry date drives the due date directly, so the
      // repeat-interval fields are ignored in that case.
      repeatValue: expiryDate ? null : hasRepeat ? rv : null,
      repeatUnit: expiryDate ? null : hasRepeat ? repeatUnit : null,
      expiryDate,
      source,
    });

    navigation.goBack();
  }

  const canSave = name.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colours.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View style={styles.field}>
          <TextInput
            ref={nameRef}
            style={styles.nameInput}
            placeholder="What have you done?"
            placeholderTextColor={colours.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
        </View>

        {/* Scanned-photo banner */}
        {prefill && (
          <View
            style={[
              styles.scanBanner,
              prefill.lowConfidence && styles.scanBannerWarn,
            ]}
          >
            <Text style={styles.scanBannerText}>
              {prefill.lowConfidence
                ? 'Read from the photo — low confidence, please check the name and date.'
                : 'Reminder based on the date read from the photo — edit if wrong.'}
            </Text>
          </View>
        )}

        {/* Suggestion banner */}
        {!expiryDate && suggestion && !suggestionApplied && repeatValue === '' && (
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

        {expiryDate ? (
          /* Expiry date (from photo scan) replaces the repeat-interval controls */
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Use by</Text>
            <TouchableOpacity style={styles.rowButton} onPress={() => setShowExpiryPicker(true)}>
              <Text style={styles.rowButtonText}>{formatDisplay(parseDate(expiryDate))}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setExpiryDate(null)}>
              <Text style={styles.switchToManualText}>Set a repeat interval instead</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Repeat every */
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Repeat every</Text>
            <TextInput
              style={styles.repeatInput}
              placeholder="—"
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
                  style={[styles.unitBtn, repeatUnit === u && styles.unitBtnActive]}
                  onPress={() => setRepeatUnit(u)}
                >
                  <Text style={[styles.unitBtnText, repeatUnit === u && styles.unitBtnTextActive]}>
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text style={styles.saveBtnText}>Track this</Text>
        </TouchableOpacity>
      </ScrollView>

      {showDatePicker && (
        <DatePickerModal
          value={lastDoneDate}
          onConfirm={(d) => { setLastDoneDate(d); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      )}

      {showExpiryPicker && (
        <DatePickerModal
          value={expiryDate ?? todayString()}
          onConfirm={(d) => { setExpiryDate(d); setShowExpiryPicker(false); }}
          onCancel={() => setShowExpiryPicker(false)}
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
    fontWeight: '600',
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
  suggestionText: { fontSize: 13, color: '#7A5C2A' },
  suggestionApply: { fontSize: 13, fontWeight: '600', color: '#C8842A' },
  scanBanner: {
    backgroundColor: '#F1F5F1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#D7E5D7',
  },
  scanBannerWarn: {
    backgroundColor: '#FFF8EE',
    borderColor: '#F0D9B0',
  },
  scanBannerText: { fontSize: 13, color: colours.textSecondary, lineHeight: 18 },
  switchToManualText: {
    fontSize: 13,
    color: colours.textSecondary,
    marginTop: 8,
    textDecorationLine: 'underline',
  },
  fieldGroup: { marginBottom: 20 },
  label: {
    fontSize: 11,
    fontWeight: '600',
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
  rowButtonText: { fontSize: 15, color: colours.textPrimary },
  repeatInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    fontSize: 15,
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
  unitBtnText: { fontSize: 13, color: colours.textSecondary },
  unitBtnTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
