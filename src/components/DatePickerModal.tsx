/**
 * A simple date picker implemented with ScrollView pickers (day / month / year).
 * Works on Android and iOS without any native module beyond core React Native.
 */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { parseDate, formatStorage } from '../utils/dateUtils';
import { colours, fonts } from '../theme/tokens';

interface Props {
  value: string; // YYYY-MM-DD
  onConfirm: (dateStr: string) => void;
  onCancel: () => void;
  /** Shown at the top. Defaults to "Last done". */
  title?: string;
  /** Years after this one to offer (a due date). Defaults to none. */
  futureYears?: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const ITEM_H = 44;

function WheelPicker({
  items,
  selectedIndex,
  onSelect,
  testIDPrefix,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  testIDPrefix?: string;
}) {
  return (
    <ScrollView
      style={styles.wheel}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      contentOffset={{ x: 0, y: selectedIndex * ITEM_H }}
      onMomentumScrollEnd={(e) => {
        const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
        onSelect(Math.max(0, Math.min(idx, items.length - 1)));
      }}
    >
      {/* padding items so selected is centred */}
      <View style={{ height: ITEM_H }} />
      {items.map((label, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.wheelItem, i === selectedIndex && styles.wheelItemSelected]}
          onPress={() => onSelect(i)}
          testID={testIDPrefix ? `${testIDPrefix}-${label}` : undefined}
        >
          <Text
            style={[
              styles.wheelItemText,
              i === selectedIndex && styles.wheelItemTextSelected,
            ]}
          >
            {label}
          </Text>
        </TouchableOpacity>
      ))}
      <View style={{ height: ITEM_H }} />
    </ScrollView>
  );
}

export default function DatePickerModal({ value, onConfirm, onCancel, title = 'Last done', futureYears = 0 }: Props) {
  const initial = parseDate(value);
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth()); // 0-indexed
  const [day, setDay] = useState(initial.getDate()); // 1-indexed

  const currentYear = new Date().getFullYear();
  // Always includes the year of the date shown
  const firstYear = Math.min(currentYear - 5, initial.getFullYear());
  const lastYear = Math.max(currentYear + futureYears, initial.getFullYear());
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => String(firstYear + i));
  const months = MONTHS;
  const numDays = daysInMonth(year, month);
  const clampedDay = Math.min(day, numDays);
  const days = Array.from({ length: numDays }, (_, i) => String(i + 1).padStart(2, '0'));

  function handleConfirm() {
    const d = new Date(year, month, clampedDay);
    onConfirm(formatStorage(d));
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.toolbar}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.toolbarCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.toolbarTitle}>{title}</Text>
          <TouchableOpacity onPress={handleConfirm} testID="date-picker-done">
            <Text style={styles.toolbarDone}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.pickers}>
          {/* Day */}
          <WheelPicker
            items={days}
            selectedIndex={clampedDay - 1}
            onSelect={(i) => setDay(i + 1)}
          />
          {/* Month */}
          <WheelPicker
            items={months}
            selectedIndex={month}
            onSelect={(i) => setMonth(i)}
          />
          {/* Year */}
          <WheelPicker
            items={years}
            testIDPrefix="date-year"
            selectedIndex={years.indexOf(String(year))}
            onSelect={(i) => setYear(firstYear + i)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sheet: {
    backgroundColor: colours.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
  },
  toolbarCancel: { fontFamily: fonts.regular, fontSize: 15, color: colours.textSecondary },
  toolbarTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colours.textPrimary },
  toolbarDone: { fontSize: 15, fontFamily: fonts.semibold, color: colours.textPrimary },
  pickers: {
    flexDirection: 'row',
    height: ITEM_H * 3 + ITEM_H * 2, // 3 visible rows + 2 padding rows
    paddingHorizontal: 12,
  },
  wheel: {
    flex: 1,
  },
  wheelItem: {
    height: ITEM_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelItemSelected: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colours.border,
  },
  wheelItemText: {
    fontFamily: fonts.regular, fontSize: 15,
    color: colours.textSecondary,
  },
  wheelItemTextSelected: {
    color: colours.textPrimary,
    fontFamily: fonts.semibold,
  },
});
