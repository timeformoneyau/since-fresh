import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { RootStackParamList } from '../types';
import { DerivedItem } from '../domain/items/types';
import { LIMITS } from '../domain/sync/limits';
import {
  getDerivedItemById,
  updateHistoryEntry,
  deleteHistoryEntry,
  dateBounds,
  HistoryError,
} from '../domain/items/service';
import { parseDate, formatDisplay, todayString } from '../utils/dateUtils';
import { palette, colours, fonts, type, radius, space, cardShadow, TAP } from '../theme/tokens';
import { useToast } from '../components/Toast';
import DatePickerModal from '../components/DatePickerModal';

type Nav = NativeStackNavigationProp<RootStackParamList, 'EditEntry'>;
type Route = RouteProp<RootStackParamList, 'EditEntry'>;

const display = (date: string) => formatDisplay(parseDate(date));

/** "Somewhere between 9 Aug 2026 and 11 Sep 2026, the entries either side." */
function boundsHelp(min: string | null, max: string, isNewest: boolean): string {
  const upper = isNewest ? 'today' : display(max);
  if (min === null) return `Any date up to ${upper}.`;
  return isNewest
    ? `Somewhere between ${display(min)} and today.`
    : `Somewhere between ${display(min)} and ${upper}, the entries either side.`;
}

export default function EditHistoryEntryScreen() {
  const navigation = useNavigation<Nav>();
  const { itemId, entryId } = useRoute<Route>().params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const showToast = useToast();

  const [item, setItem] = useState<DerivedItem | null>(null);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const derived = await getDerivedItemById(itemId);
      const entry = derived?.history.find((e) => e.id === entryId);
      if (!derived || !entry) { navigation.goBack(); return; }
      setItem(derived);
      setDate(entry.date);
      setNote(entry.note ?? '');
    })();
  }, [itemId, entryId, navigation]);

  if (!item) return null;

  const index = item.history.findIndex((e) => e.id === entryId); // newest first
  const total = item.history.length;
  const number = total - index; // oldest is entry 1
  const { min, max } = dateBounds(item, entryId, todayString());
  // The server's limit (sync/limits.ts); a longer note saved before the
  // limit existed still shows in full and can be shortened
  const savedNote = item.history[index]?.note ?? '';
  const noteLimit = Math.max(LIMITS.note, savedNote.length);
  const inRange = (min === null || date >= min) && date <= max;

  async function handleSave() {
    if (!inRange) {
      setError('Pick a date between the entries either side of this one.');
      return;
    }
    try {
      await updateHistoryEntry(itemId, entryId, { date, note });
      navigation.goBack();
    } catch (e) {
      if (e instanceof HistoryError) setError(e.message);
      else showToast({ message: "Couldn't save that. Please try again." });
    }
  }

  function handleDelete() {
    if (total <= 1) {
      setError('Every item needs at least one entry. Delete the item instead.');
      return;
    }
    Alert.alert('Delete this entry?', `The ${display(date)} entry will be removed from ${item!.name}'s history.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteHistoryEntry(itemId, entryId);
            navigation.goBack();
          } catch (e) {
            setError(e instanceof HistoryError ? e.message : "Couldn't delete that. Please try again.");
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={type.screenTitle} accessibilityRole="header">Edit entry</Text>
        <Text style={[type.secondary, styles.subtitle]}>
          {item.name} · entry {number} of {total}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>When was it done?</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setPicking(true)}
            testID="entry-date-button"
            accessibilityRole="button"
            accessibilityLabel={`Date, ${display(date)}. Change`}
          >
            <Text style={type.body}>{display(date)}</Text>
          </TouchableOpacity>
          <Text style={[type.secondary, styles.help]} testID="entry-date-help">
            {boundsHelp(min, max, index === 0)}
          </Text>

          <Text style={[styles.label, styles.gapAbove]}>Note (optional)</Text>
          <TextInput
            style={[styles.field, styles.input]}
            value={note}
            onChangeText={setNote}
            placeholder="Anything worth remembering"
            placeholderTextColor={palette.muted}
            testID="entry-note-input"
            maxLength={noteLimit}
            returnKeyType="done"
          />
        </View>

        <View style={styles.info}>
          <Text style={styles.infoText}>
            Changing a date updates the gaps in this item's history. Your next due date only moves if
            you change the latest entry.
          </Text>
        </View>

        {error && (
          <Text style={styles.error} testID="entry-error" accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleSave}
          testID="entry-save-button"
          accessibilityRole="button"
        >
          <Text style={styles.primaryBtnText}>Save changes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={handleDelete}
          testID="entry-delete-button"
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>Delete this entry</Text>
        </TouchableOpacity>
      </ScrollView>

      {picking && (
        <DatePickerModal
          value={date}
          onConfirm={(d) => { setDate(d); setError(null); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.background },
  content: { padding: space.screen, paddingTop: 8 },
  subtitle: { marginTop: 2, marginBottom: 16 },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    ...cardShadow,
  },
  label: { fontFamily: fonts.bold, fontSize: 15, color: palette.ink, marginBottom: 8 },
  gapAbove: { marginTop: 18 },
  field: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: palette.inputBg,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  input: { ...type.body },
  help: { marginTop: 8 },
  info: {
    backgroundColor: palette.infoBg,
    borderRadius: 16,
    padding: 14,
    marginTop: space.cardGap,
  },
  infoText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: palette.infoText },
  error: { fontFamily: fonts.semibold, fontSize: 14, color: palette.danger, marginTop: 14 },
  primaryBtn: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  primaryBtnText: { ...type.button, color: '#FFFFFF' },
  deleteBtn: { minHeight: TAP, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  deleteText: { fontFamily: fonts.bold, fontSize: 15, color: palette.danger },
});
