import React, { useState } from 'react';
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
import { signUp } from '../../domain/auth/service';
import { colours } from '../../components/colours';
import { authStyles as s } from './authStyles';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;

const MIN_PASSWORD_LENGTH = 6;

export default function SignUpScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmationSent, setConfirmationSent] = useState(false);

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
        setConfirmationSent(true);
      }
      // Otherwise the auth listener in App.tsx takes over.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (confirmationSent) {
    return (
      <ScrollView contentContainerStyle={s.container} style={s.flex}>
        <Text style={s.appName}>Since</Text>
        <Text style={s.heading}>Check your email</Text>
        <Text style={s.subheading}>
          We've sent a confirmation link to {email.trim().toLowerCase()}. Open it to
          finish setting up your account, then come back and sign in.
        </Text>
        <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('SignIn')}>
          <Text style={s.primaryBtnText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    );
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
