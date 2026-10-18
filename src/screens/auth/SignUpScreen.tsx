import React, { useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types';
import { signUp } from '../../domain/auth/service';
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from '../../domain/auth/errors';
import { colours } from '../../components/colours';
import { authStyles as s } from './authStyles';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;

export default function SignUpScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignUp() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError('Please enter your email and a password.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password needs to be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp(trimmedEmail, password);
      if (needsConfirmation) {
        navigation.navigate('EnterCode', { email: trimmedEmail, purpose: 'signup' });
      }
      // Otherwise the auth listener in App.tsx takes over.
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setLoading(false);
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
        <Text style={s.appName}>Since</Text>
        <Text style={s.heading}>Create an account</Text>
        <Text style={s.subheading}>
          An account keeps your list backed up and on every device you use.
        </Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(''); }}
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
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              placeholderTextColor={colours.textMuted}
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
              accessibilityLabel="Password"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            onPress={handleSignUp}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>
              {loading ? 'Creating account…' : 'Create account'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
            <Text style={s.footerLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
