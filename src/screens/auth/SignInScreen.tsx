import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { sendSignInCode } from '../../domain/auth/service';
import { friendlyAuthError } from '../../domain/auth/errors';
import { takeSignInNotice, onSignInNotice } from '../../domain/auth/sessionNotice';
import { colours } from '../../theme/tokens';
import { authStyles as s } from './authStyles';
import KeyboardSafeView from '../../components/KeyboardSafeView';

type Nav = NativeStackNavigationProp<RootStackParamList, 'SignIn'>;

/**
 * Sign in, or create an account, with an emailed code (no password). Opened
 * from Account; the list stays usable without ever coming here.
 */
export default function SignInScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Why the user is here, after an expired or revoked session.
  const [notice, setNotice] = useState(() => takeSignInNotice() ?? '');

  useEffect(() => onSignInNotice(() => setNotice(takeSignInNotice() ?? '')), []);

  async function handleSendCode() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Enter your email address.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await sendSignInCode(trimmedEmail);
      navigation.navigate('EnterCode', { email: trimmedEmail, purpose: 'sign_in' });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardSafeView style={s.flex}>
      <ScrollView
        contentContainerStyle={[s.container, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.heading}>Back up and sync</Text>
        <Text style={s.subheading}>
          Enter your email and we'll send you a code. If you're new, the code sets up your account.
        </Text>

        <View style={s.form}>
          {notice !== '' && <Text style={s.noticeText}>{notice}</Text>}

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              testID="signin-email-input"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(''); }}
              placeholder="you@example.com"
              placeholderTextColor={colours.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="done"
              onSubmitEditing={handleSendCode}
              accessibilityLabel="Email"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            testID="signin-send-code-button"
            onPress={handleSendCode}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>{loading ? 'Sending…' : 'Send code'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardSafeView>
  );
}
