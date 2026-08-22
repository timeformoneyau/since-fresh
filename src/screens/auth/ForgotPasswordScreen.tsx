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
import { sendPasswordReset } from '../../domain/auth/service';
import { colours } from '../../components/colours';
import { authStyles as s } from './authStyles';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleReset() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Please enter your email.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the reset email.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <ScrollView contentContainerStyle={s.container} style={s.flex}>
        <Text style={s.appName}>Since</Text>
        <Text style={s.heading}>Check your email</Text>
        <Text style={s.subheading}>
          If an account exists for {email.trim().toLowerCase()}, we've sent a link to
          reset your password.
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
        <Text style={s.heading}>Reset password</Text>
        <Text style={s.subheading}>
          Enter your email and we'll send you a link to set a new password.
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
              returnKeyType="done"
              onSubmitEditing={handleReset}
              accessibilityLabel="Email"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            onPress={handleReset}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>
              {loading ? 'Sending…' : 'Send reset link'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.linkBtn} onPress={() => navigation.navigate('SignIn')}>
            <Text style={s.linkText}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
