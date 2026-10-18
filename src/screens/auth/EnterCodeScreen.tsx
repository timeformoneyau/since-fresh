import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList, RootStackParamList } from '../../types';
import { verifyCode, resendCode, CodePurpose } from '../../domain/auth/service';
import { friendlyAuthError } from '../../domain/auth/errors';
import { secondsUntilResend, isValidCodeFormat } from '../../domain/auth/cooldown';
import { colours } from '../../components/colours';
import { authStyles as s } from './authStyles';

type AuthNav = NativeStackNavigationProp<AuthStackParamList, 'EnterCode'>;
type AppNav = NativeStackNavigationProp<RootStackParamList, 'EnterCode'>;
type Route = RouteProp<{ EnterCode: { email: string; purpose: CodePurpose } }, 'EnterCode'>;

/**
 * Shared by sign-up confirmation, password reset (D2: codes, not links) and,
 * inside the signed-in app, email change (F10). The previous screen has just
 * sent a code, so the resend cooldown starts now.
 */
export default function EnterCodeScreen() {
  const navigation = useNavigation<AuthNav | AppNav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
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
      if (changingEmail) {
        // Still signed in, now with the new address; Account shows it.
        (navigation as AppNav).popTo('Account');
        return;
      }
      // The auth listener in App.tsx takes over: the list for sign-up,
      // "Set a new password" for recovery.
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
    <KeyboardAvoidingView
      style={s.flex}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={[s.container, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!changingEmail && <Text style={s.appName}>Since</Text>}
        <Text style={s.heading}>Enter your code</Text>
        <Text style={s.subheading}>
          {purpose === 'recovery'
            ? `If there's an account for ${email}, we've emailed it a code to reset the password.`
            : changingEmail
            ? `We've emailed a code to ${email}. Enter it to switch your account to this address.`
            : `We've emailed a code to ${email}. Enter it to finish setting up your account.`}
        </Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>Code</Text>
            <TextInput
              style={[s.input, s.codeInput]}
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

          {!changingEmail && (
            <Text style={s.noticeText}>If you already have an account, sign in instead.</Text>
          )}
        </View>

        {!changingEmail && (
          <View style={s.footer}>
            <TouchableOpacity onPress={() => (navigation as AuthNav).navigate('SignIn')}>
              <Text style={s.footerLink}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
