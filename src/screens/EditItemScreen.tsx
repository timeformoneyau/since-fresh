import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, RepeatUnit } from '../types';
import { loadItems, updateItem, deleteItem } from '../storage/items';
import { formatDisplay, parseDate, todayString } from '../utils/dateUtils';
import {
  scheduleItemNotifications,
  cancelItemNotifications,
} from '../notifications/scheduler';
import { colours } from '../components/colours';
import DatePickerModal from '../components/DatePickerModal';
import CategoryPicker from '../components/CategoryPicker';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Edit'>;
type Route = RouteProp<RootStackParamList, 'Edit'>;

const REPEAT_UNITS: RepeatUnit[] = ['days', 'weeks', 'months', 'years'];

export default function EditItemScreen() {
  const navigation = useNavigation<Nav>();
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

  useEffect(() => {
    (async () => {
      const items = await loadItems();
      const item = items.find((i) => i.id === itemId);
      if (!item) { navigation.goBack(); return; }
      setName(item.name);
      setCategory(item.category);
      setLastDoneDate(item.lastDoneDate);
      setRepeatValue(item.repeatValue ? String(item.repeatValue) : '');
      setRepeatUnit(item.repeatUnit ?? 'months');
      setLoading(false);
    })();
  }, [itemId]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const rv = repeatValue ? parseInt(repeatValue, 10) : null;
    const ru = rv && rv > 0 ? repeatUnit : null;

    const items = await loadItems();
    const existing = items.find((i) => i.id === itemId);
    if (!existing) return;

    const updated = {
      ...existing,
      name: trimmed,
      category,
      lastDoneDate,
      repeatValue: rv && rv > 0 ? rv : null,
      repeatUnit: ru,
      updatedAt: new Date().toISOString(),
    };

    await updateItem(updated);
    await scheduleItemNotifications(updated);
    navigation.goBack();
  }

  async function handleDelete() {
    Alert.alert(
      'Delete item',
      `Remove "${name}" from Since?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await cancelItemNotifications(itemId);
            await deleteItem(itemId);
            navigation.goBack();
          },
        },
      ],
    );
  }

  if (loading) return null;

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
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.textInput}
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
          <Text style={styles.label}>Repeat every</Text>
          <View style={styles.repeatRow}>
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
                  style={[
                    styles.unitBtn,
                    repeatUnit === u && styles.unitBtnActive,
                  ]}
                  onPress={() => setRepeatUnit(u)}
                >
                  <Text
                    style={[
                      styles.unitBtnText,
                      repeatUnit === u && styles.unitBtnTextActive,
                    ]}
                  >
                    {u}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text style={styles.saveBtnText}>Save changes</Text>
        </TouchableOpacity>

        {/* Delete */}
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
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
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: 14, color: colours.destructive },
});
