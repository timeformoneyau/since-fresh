import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types';
import { signIn, resendSignupCode } from '../../domain/auth/service';
import { friendlyAuthError, authErrorCode } from '../../domain/auth/errors';
import { takeSignInNotice, onSignInNotice } from '../../domain/auth/sessionNotice';
import { colours } from '../../components/colours';
import { authStyles as s } from './authStyles';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'SignIn'>;

export default function SignInScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  // Why the user is here, after an expired or revoked session.
  const [notice, setNotice] = useState(() => takeSignInNotice() ?? '');

  useEffect(() => onSignInNotice(() => setNotice(takeSignInNotice() ?? '')), []);

  async function handleSignIn() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setNotice('');
    setUnconfirmed(false);
    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
      // The auth listener in App.tsx switches to the main navigator.
    } catch (e) {
      setError(friendlyAuthError(e));
      setUnconfirmed(authErrorCode(e) === 'email_not_confirmed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    const trimmedEmail = email.trim().toLowerCase();
    setSendingCode(true);
    try {
      await resendSignupCode(trimmedEmail);
      setError('');
      setUnconfirmed(false);
      navigation.navigate('EnterCode', { email: trimmedEmail, purpose: 'signup' });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setSendingCode(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.appName}>Since</Text>
        <Text style={s.heading}>Sign in</Text>
        <Text style={s.subheading}>Good to have you back.</Text>

        <View style={s.form}>
          {notice !== '' && <Text style={s.noticeText}>{notice}</Text>}

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(''); setUnconfirmed(false); }}
              placeholder="you@example.com"
              placeholderTextColor={colours.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
              accessibilityLabel="Email"
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(''); }}
              placeholder="••••••••"
              placeholderTextColor={colours.textMuted}
              secureTextEntry
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
              accessibilityLabel="Password"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          {unconfirmed && (
            <TouchableOpacity
              style={[s.primaryBtn, sendingCode && s.btnDisabled]}
              onPress={handleSendCode}
              disabled={sendingCode}
              accessibilityRole="button"
            >
              <Text style={s.primaryBtnText}>{sendingCode ? 'Sending…' : 'Send a code'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            onPress={handleSignIn}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.linkBtn}
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={s.linkText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
            <Text style={s.footerLink}>Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
