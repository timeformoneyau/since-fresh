import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { verifyCode, resendCode } from '../../domain/auth/service';
import { codeSentCopy } from '../../domain/auth/codes';
import { friendlyAuthError } from '../../domain/auth/errors';
import { secondsUntilResend, isValidCodeFormat } from '../../domain/auth/cooldown';
import { colours } from '../../theme/tokens';
import { authStyles as s } from './authStyles';
import KeyboardSafeView from '../../components/KeyboardSafeView';

type Nav = NativeStackNavigationProp<RootStackParamList, 'EnterCode'>;
type Route = RouteProp<RootStackParamList, 'EnterCode'>;

/**
 * Shared by sign-in (D2: codes, not links) and email change (F10). The
 * previous screen has just sent a code, so the resend cooldown starts now.
 */
export default function EnterCodeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { email, purpose } = useRoute<Route>().params;
  const changingEmail = purpose === 'email_change';
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastSentAt, setLastSentAt] = useState<number | null>(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const wait = secondsUntilResend(lastSentAt, now);
  const coolingDown = wait > 0;

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [coolingDown]);

  async function handleVerify() {
    if (!isValidCodeFormat(code)) {
      setError("Enter the code from the email. It's 6 to 8 digits.");
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await verifyCode(email, code, purpose);
      // Email change: still signed in, now with the new address; Account
      // shows it. Sign-in: the auth listener in App.tsx sorts out the list
      // (ownership.ts), then the list shows.
      navigation.popTo(changingEmail ? 'Account' : 'Main');
    } catch (e) {
      setError(friendlyAuthError(e, changingEmail ? 'change-email' : undefined));
      setLoading(false);
    }
  }

  async function handleResend() {
    if (wait > 0) return;
    setError('');
    setNotice('');
    try {
      await resendCode(email, purpose);
      setLastSentAt(Date.now());
      setNow(Date.now());
      setCode('');
      setNotice("We've sent a new code.");
    } catch (e) {
      setError(friendlyAuthError(e, changingEmail ? 'change-email' : undefined));
    }
  }

  return (
    <KeyboardSafeView style={s.flex}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.heading}>Enter your code</Text>
        <Text style={s.subheading}>{codeSentCopy(purpose, email)}</Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>Code</Text>
            <TextInput
              style={[s.input, s.codeInput]}
              testID="code-input"
              value={code}
              onChangeText={(t) => { setCode(t.replace(/\D/g, '').slice(0, 8)); setError(''); }}
              placeholder="123456"
              placeholderTextColor={colours.textMuted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleVerify}
              accessibilityLabel="Code"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}
          {notice !== '' && <Text style={s.noticeText}>{notice}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            testID="code-continue-button"
            onPress={handleVerify}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>{loading ? 'Checking…' : 'Continue'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.linkBtn}
            onPress={handleResend}
            disabled={wait > 0}
            accessibilityRole="button"
          >
            <Text style={[s.linkText, wait > 0 && s.btnDisabled]}>
              {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardSafeView>
  );
}
