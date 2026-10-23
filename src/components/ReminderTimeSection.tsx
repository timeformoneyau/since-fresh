import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setReminderTime } from '../domain/items/service';
import { loadReminderTime } from '../notifications/reminderTimeStore';
import {
  REMINDER_TIME_OPTIONS,
  formatReminderTime,
  sameTime,
  timeKey,
  type ReminderTime,
} from '../notifications/reminderTime';
import { useToast } from './Toast';
import { REMINDERS_COPY } from '../notifications/permission';
import { recheckReminderPermission, openReminderSettings } from '../notifications/permissionFlow';
import { colours, fonts, palette, radius, TAP } from '../theme/tokens';

/** Account / Settings: the one time of day reminders go out. */
export default function ReminderTimeSection() {
  const showToast = useToast();
  const [time, setTime] = useState<ReminderTime | null>(null);
  const [off, setOff] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadReminderTime().then(setTime).catch(() => {});
      recheckReminderPermission().then((on) => setOff(!on)).catch(() => {});
    }, []),
  );

  async function choose(next: ReminderTime) {
    if (time && sameTime(time, next)) return;
    const previous = time;
    setTime(next);
    try {
      await setReminderTime(next);
      showToast({ message: `Reminders will come at ${formatReminderTime(next)}` });
    } catch {
      setTime(previous);
      showToast({ message: "Couldn't change that. Please try again." });
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Reminders</Text>
      {off && (
        <View testID="settings-reminders-off">
          <Text style={styles.body}>{REMINDERS_COPY.settingsOff}</Text>
          <TouchableOpacity
            style={styles.settingsLink}
            testID="settings-reminders-open"
            onPress={() => void openReminderSettings()}
            accessibilityRole="button"
          >
            <Text style={styles.settingsLinkText}>{REMINDERS_COPY.openSettings}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.body}>What time of day should reminders come?</Text>
      <View style={styles.row}>
        {REMINDER_TIME_OPTIONS.map((o) => {
          const on = time !== null && sameTime(time, o);
          return (
            <TouchableOpacity
              key={timeKey(o)}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => choose(o)}
              testID={`reminder-time-${timeKey(o)}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{formatReminderTime(o)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  label: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colours.textSecondary, marginBottom: 10, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  settingsLink: { minHeight: TAP, justifyContent: 'center', alignSelf: 'flex-start', marginTop: -6, marginBottom: 6 },
  settingsLinkText: { fontFamily: fonts.semibold, fontSize: 14, color: colours.textPrimary },
  chip: {
    minHeight: TAP,
    minWidth: 72,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipOn: { backgroundColor: palette.navy, borderColor: palette.navy },
  chipText: { fontFamily: fonts.medium, fontSize: 15, color: colours.textPrimary },
  chipTextOn: { color: '#FFFFFF' },
});
