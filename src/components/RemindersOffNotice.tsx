import React, { useCallback, useEffect, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { REMINDERS_COPY } from '../notifications/permission';
import {
  remindersOffNoticeVisible,
  dismissRemindersOffNotice,
  openReminderSettings,
  recheckReminderPermission,
} from '../notifications/permissionFlow';
import { palette, fonts, radius, space, cardShadow, TAP } from '../theme/tokens';

/**
 * On the list, while reminders are off and something repeats: one calm line
 * and a way to the phone's settings. Hiding it is for good. Looks again when
 * the list comes into view and when the app comes back (say, from settings);
 * once reminders are on, every reminder is scheduled again.
 */
export default function RemindersOffNotice({ hasRepeating }: { hasRepeating: boolean }) {
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    await recheckReminderPermission().catch(() => false);
    setVisible(await remindersOffNoticeVisible(hasRepeating).catch(() => false));
  }, [hasRepeating]);

  useFocusEffect(useCallback(() => { void check(); }, [check]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  if (!visible) return null;

  return (
    <View style={styles.card} testID="reminders-off-notice">
      <Text style={styles.text}>{REMINDERS_COPY.offNotice}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.button}
          testID="reminders-off-settings"
          onPress={() => void openReminderSettings()}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{REMINDERS_COPY.openSettings}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          testID="reminders-off-dismiss"
          onPress={() => {
            setVisible(false);
            void dismissRemindersOffNotice();
          }}
          accessibilityRole="button"
          accessibilityLabel="Hide this notice"
        >
          <Text style={styles.dismissText}>{REMINDERS_COPY.dismiss}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    marginHorizontal: space.screen,
    marginBottom: space.cardGap,
    ...cardShadow,
  },
  text: { fontFamily: fonts.regular, fontSize: 14.5, color: palette.ink, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 16, marginTop: 6 },
  button: { minHeight: TAP, justifyContent: 'center' },
  buttonText: { fontFamily: fonts.bold, fontSize: 14.5, color: palette.navy },
  dismissText: { fontFamily: fonts.regular, fontSize: 14.5, color: palette.muted },
});
