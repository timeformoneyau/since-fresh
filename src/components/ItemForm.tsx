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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RepeatUnit, DEFAULT_CATEGORIES } from '../types';
import { todayString, formatDisplay, formatStorage, parseDate, getNextDueDate } from '../utils/dateUtils';
import { getSuggestion } from '../utils/suggestions';
import { intervalText } from '../domain/items/display';
import { palette, colours, fonts, type, radius, space, cardShadow, TAP } from '../theme/tokens';
import DatePickerModal from './DatePickerModal';

const REPEAT_UNITS: RepeatUnit[] = ['days', 'weeks', 'months', 'years'];
const MIN_REPEAT = 1;
const MAX_REPEAT = 99;

export interface ItemFormValues {
  name: string;
  category: string;
  lastDoneDate: string;
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  /** Shared with the household (only offered when there is one). */
  shared?: boolean;
}

interface Props {
  /** testID prefix: 'add' or 'edit'. */
  prefix: 'add' | 'edit';
  title: string;
  initial: ItemFormValues;
  submitLabel: string;
  /** Helper under the date field. */
  dateHelp: string;
  /** Start the stepper at a keyword suggestion as the name is typed (Add only). */
  suggestFromName?: boolean;
  autoFocusName?: boolean;
  onSubmit: (values: ItemFormValues) => void;
  /** Extra content under the main button (Edit: delete). */
  footer?: React.ReactNode;
  /** Offer "Who is this for?" (households): the household's name. */
  householdName?: string;
}

function yesterdayString(): string {
  const d = parseDate(todayString());
  d.setDate(d.getDate() - 1);
  return formatStorage(d);
}

/** Add / Edit item form (docs/SINCE_REDESIGN_BRIEF.md, section 3.4). */
export default function ItemForm({
  prefix,
  title,
  initial,
  submitLabel,
  dateHelp,
  suggestFromName,
  autoFocusName,
  onSubmit,
  footer,
  householdName,
}: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const nameRef = useRef<TextInput>(null);

  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState(initial.category);
  const [lastDoneDate, setLastDoneDate] = useState(initial.lastDoneDate);
  const [repeats, setRepeats] = useState(initial.repeatValue !== null);
  const [shared, setShared] = useState(initial.shared ?? false);
  const [repeatValue, setRepeatValue] = useState(initial.repeatValue ?? 30);
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>(initial.repeatUnit ?? 'days');
  const [intervalTouched, setIntervalTouched] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showNameHint, setShowNameHint] = useState(false);

  useEffect(() => {
    if (!autoFocusName) return;
    const timer = setTimeout(() => nameRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [autoFocusName]);

  // Keyword suggestion: start the stepper there until the user sets it
  const suggestion = suggestFromName ? getSuggestion(name) : null;
  useEffect(() => {
    if (suggestion && !intervalTouched) {
      setRepeatValue(suggestion.repeatValue);
      setRepeatUnit(suggestion.repeatUnit);
    }
  }, [suggestion?.repeatValue, suggestion?.repeatUnit, intervalTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSave = name.trim().length > 0;
  const nextDue = formatDisplay(getNextDueDate(lastDoneDate, repeatValue, repeatUnit));
  const categories: string[] = (DEFAULT_CATEGORIES as readonly string[]).includes(category)
    ? [...DEFAULT_CATEGORIES]
    : [...DEFAULT_CATEGORIES, category];

  function step(by: number) {
    setIntervalTouched(true);
    setRepeatValue((v) => Math.min(MAX_REPEAT, Math.max(MIN_REPEAT, v + by)));
  }

  function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setShowNameHint(true);
      return;
    }
    onSubmit({
      name: trimmed,
      category,
      lastDoneDate,
      repeatValue: repeats ? repeatValue : null,
      repeatUnit: repeats ? repeatUnit : null,
      ...(householdName !== undefined ? { shared } : {}),
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colours.background }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={type.screenTitle} accessibilityRole="header">{title}</Text>

        {/* 1. Name */}
        <View style={styles.card}>
          <Text style={styles.heading}>What is it?</Text>
          <TextInput
            ref={nameRef}
            style={styles.input}
            testID={`${prefix}-name-input`}
            placeholder="e.g. Haircut"
            placeholderTextColor={palette.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            returnKeyType="done"
            accessibilityLabel="Name"
          />
        </View>

        {/* Who is this for? (households) */}
        {householdName !== undefined && (
          <View style={styles.card}>
            <Text style={styles.heading}>Who is this for?</Text>
            <View style={styles.options} accessibilityRole="radiogroup">
              <Option
                testID={`${prefix}-justme-option`}
                selected={!shared}
                onPress={() => setShared(false)}
                icon="account-outline"
                tileBg={palette.infoBg}
                title="Just me"
                caption="Only you see it"
              />
              <Option
                testID={`${prefix}-household-option`}
                selected={shared}
                onPress={() => setShared(true)}
                icon="home-outline"
                tileBg="#D7ECF2"
                title="Household"
                caption={`Shared with ${householdName}`}
              />
            </View>
          </View>
        )}

        {/* 2. Does it repeat? */}
        <View style={styles.card}>
          <Text style={styles.heading}>Does it repeat?</Text>
          <View style={styles.options} accessibilityRole="radiogroup">
            <Option
              testID={`${prefix}-repeats-option`}
              selected={repeats}
              onPress={() => setRepeats(true)}
              icon="repeat"
              tileBg="#D7ECF2"
              title="Repeats"
              caption="Nudge me again after a while"
            />
            <Option
              testID={`${prefix}-onceoff-option`}
              selected={!repeats}
              onPress={() => setRepeats(false)}
              icon="check"
              tileBg={palette.infoBg}
              title="Once off"
              caption="Just keep a record"
            />
          </View>
        </View>

        {/* 3. Repeat every / Once-off note */}
        {repeats ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Repeat every</Text>
            <View style={styles.stepper}>
              <StepButton
                testID={`${prefix}-stepper-minus`}
                icon="minus"
                label="Fewer"
                disabled={repeatValue <= MIN_REPEAT}
                onPress={() => step(-1)}
              />
              <Text
                style={styles.stepValue}
                testID={`${prefix}-repeat-value`}
                accessibilityLabel={`Every ${intervalText(repeatValue, repeatUnit)}`}
              >
                {repeatValue}
              </Text>
              <StepButton
                testID={`${prefix}-stepper-plus`}
                icon="plus"
                label="More"
                disabled={repeatValue >= MAX_REPEAT}
                onPress={() => step(1)}
              />
            </View>
            <View style={styles.unitRow}>
              {REPEAT_UNITS.map((u) => {
                const selected = repeatUnit === u;
                return (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitBtn, selected && styles.selectedFill]}
                    onPress={() => { setIntervalTouched(true); setRepeatUnit(u); }}
                    testID={`${prefix}-unit-${u}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.unitText, selected && styles.selectedText]}>{u}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.amberRow} testID={`${prefix}-next-due`}>
              <MaterialCommunityIcons name="calendar-clock" size={18} color={palette.amberText} />
              <Text style={styles.amberText}>Next due {nextDue}</Text>
            </View>
            {suggestion && !intervalTouched && (
              <Text style={[type.secondary, styles.help]}>
                Things like this usually come round every {intervalText(suggestion.repeatValue, suggestion.repeatUnit)}, so
                we've started you there. Change it any time.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.infoCard} testID={`${prefix}-onceoff-info`}>
            <Text style={styles.infoText}>
              Once-off things stay in your list as a record, with no reminders. You can switch to
              repeating whenever you like, and the history comes with it.
            </Text>
          </View>
        )}

        {/* 4. Last done */}
        <View style={styles.card}>
          <Text style={styles.heading}>When did you last do it?</Text>
          <TouchableOpacity
            style={styles.input}
            testID={`${prefix}-last-done-button`}
            onPress={() => setShowDatePicker(true)}
            accessibilityRole="button"
            accessibilityLabel={`Last done ${formatDisplay(parseDate(lastDoneDate))}. Change`}
          >
            <Text style={type.body}>{formatDisplay(parseDate(lastDoneDate))}</Text>
          </TouchableOpacity>
          <View style={styles.quickRow}>
            {[
              { label: 'Today', date: todayString(), id: 'today' },
              { label: 'Yesterday', date: yesterdayString(), id: 'yesterday' },
            ].map((q) => {
              const selected = lastDoneDate === q.date;
              return (
                <TouchableOpacity
                  key={q.id}
                  style={[styles.chip, selected && styles.selectedFill]}
                  onPress={() => setLastDoneDate(q.date)}
                  testID={`${prefix}-${q.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.selectedText]}>{q.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[type.secondary, styles.help]}>{dateHelp}</Text>
        </View>

        {/* 5. Category */}
        <View style={styles.card}>
          <Text style={styles.heading}>Category</Text>
          <View style={styles.chipWrap}>
            {categories.map((c) => {
              const selected = category === c;
              return (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, selected && styles.selectedFill]}
                  onPress={() => setCategory(c)}
                  testID={`${prefix}-category-${c}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.selectedText]}>{c}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 6. Save */}
        <TouchableOpacity
          style={[styles.primaryBtn, !canSave && styles.primaryBtnMuted]}
          onPress={handleSubmit}
          testID={`${prefix}-save-button`}
          // Stays tappable so it can explain why it can't save. Explicit
          // disabled={false} is needed: TouchableOpacity otherwise treats
          // accessibilityState.disabled as disabled and swallows the tap.
          disabled={false}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={styles.primaryBtnText}>{submitLabel}</Text>
        </TouchableOpacity>
        {showNameHint && !canSave && (
          <Text style={styles.saveHint} testID={`${prefix}-save-hint`}>Add a name to save</Text>
        )}
        {footer}
      </ScrollView>

      {showDatePicker && (
        <DatePickerModal
          value={lastDoneDate}
          onConfirm={(d) => { setLastDoneDate(d); setShowDatePicker(false); }}
          onCancel={() => setShowDatePicker(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function Option(props: {
  testID: string;
  selected: boolean;
  onPress: () => void;
  icon: IconName;
  tileBg: string;
  title: string;
  caption: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.option, props.selected && styles.optionSelected]}
      onPress={props.onPress}
      testID={props.testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      accessibilityLabel={`${props.title}. ${props.caption}`}
    >
      <View style={[styles.optionTile, { backgroundColor: props.tileBg }]}>
        <MaterialCommunityIcons name={props.icon} size={24} color={palette.navy} />
      </View>
      <Text style={styles.optionTitle}>{props.title}</Text>
      <Text style={type.secondary}>{props.caption}</Text>
    </TouchableOpacity>
  );
}

function StepButton(props: { testID: string; icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.stepBtn, props.disabled && styles.stepBtnDisabled]}
      onPress={props.onPress}
      disabled={props.disabled}
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
    >
      <MaterialCommunityIcons name={props.icon} size={24} color={palette.navy} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screen, paddingTop: 8, gap: space.cardGap },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    ...cardShadow,
  },
  heading: { fontFamily: fonts.serif, fontSize: 24, color: palette.ink, marginBottom: 10 },
  input: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: palette.inputBg,
    paddingHorizontal: 14,
    justifyContent: 'center',
    ...type.body,
  },
  options: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1,
    minHeight: TAP,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: palette.border,
    padding: 12,
    gap: 4,
  },
  optionSelected: { borderColor: palette.navy, backgroundColor: palette.selectedBg },
  optionTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  optionTitle: { fontFamily: fonts.bold, fontSize: 16.5, color: palette.ink },

  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.iconBtnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.4 },
  stepValue: { fontFamily: fonts.serif, fontSize: 30, color: palette.ink, minWidth: 60, textAlign: 'center' },
  unitRow: { flexDirection: 'row', gap: 8 },
  unitBtn: {
    flex: 1,
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitText: { fontFamily: fonts.semibold, fontSize: 14.5, color: palette.ink },
  selectedFill: { backgroundColor: palette.navy, borderColor: palette.navy },
  selectedText: { color: '#FFFFFF' },
  amberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.amberBg,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  amberText: { fontFamily: fonts.semibold, fontSize: 14.5, color: palette.amberText },
  help: { marginTop: 10 },
  infoCard: { backgroundColor: palette.infoBg, borderRadius: radius.card, padding: space.cardPadding },
  infoText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: palette.infoText },

  quickRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: TAP,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.card,
    justifyContent: 'center',
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 14.5, color: palette.ink },

  primaryBtn: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnMuted: { opacity: 0.55 },
  primaryBtnText: { ...type.button, color: '#FFFFFF' },
  saveHint: { fontFamily: fonts.semibold, fontSize: 14, color: palette.danger, textAlign: 'center' },
});
