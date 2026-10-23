import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { REMINDERS_COPY, turnOnAction, type PermissionState } from '../notifications/permission';
import { currentReminderPermission, turnOnReminders, notNowReminders } from '../notifications/permissionFlow';
import { authStyles as s } from './auth/authStyles';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RemindersPermission'>;

/**
 * Shown once, after the first repeating item is saved, before the phone's
 * own prompt (notifications/permission.ts). "Not now" is a real answer:
 * nothing asks again. Leaving with Back counts as Not now.
 */
export default function RemindersPermissionScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [busy, setBusy] = useState(false);
  const answered = useRef(false);

  useEffect(() => {
    currentReminderPermission().then(setPerm).catch(() => {});
    // Back, or any way out without a choice, is Not now
    return () => {
      if (!answered.current) void notNowReminders();
    };
  }, []);

  const blocked = perm !== null && turnOnAction(perm) === 'settings';

  async function handleTurnOn() {
    answered.current = true;
    setBusy(true);
    await turnOnReminders().catch(() => {});
    navigation.goBack();
  }

  async function handleNotNow() {
    answered.current = true;
    await notNowReminders();
    navigation.goBack();
  }

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={[s.container, { paddingBottom: 40 + insets.bottom }]}
      testID="reminders-permission-screen"
    >
      <Text style={s.heading} accessibilityRole="header">{REMINDERS_COPY.heading}</Text>
      <Text style={s.subheading}>{blocked ? REMINDERS_COPY.blockedBody : REMINDERS_COPY.body}</Text>
      <View style={s.form}>
        <TouchableOpacity
          style={[s.primaryBtn, busy && s.btnDisabled]}
          testID="reminders-turn-on-button"
          onPress={handleTurnOn}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={s.primaryBtnText}>{blocked ? REMINDERS_COPY.openSettings : REMINDERS_COPY.turnOn}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.linkBtn}
          testID="reminders-not-now-button"
          onPress={handleNotNow}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={s.linkText}>{REMINDERS_COPY.notNow}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
