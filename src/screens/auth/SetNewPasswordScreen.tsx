import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { completePasswordRecovery, abandonPasswordRecovery } from '../../domain/auth/service';
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from '../../domain/auth/errors';
import { colours } from '../../theme/tokens';
import { authStyles as s } from './authStyles';

/**
 * Shown after a correct recovery code, in place of the main app, until the
 * new password is saved (auth/recovery.ts). Saving releases the hold and
 * App.tsx opens the list; backing out signs out without wiping the phone.
 */
export default function SetNewPasswordScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Android back also counts as leaving without saving.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      abandonPasswordRecovery();
      return true;
    });
    return () => sub.remove();
  }, []);

  async function handleSave() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password needs to be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setError('');
    setLoading(true);
    try {
      await completePasswordRecovery(password);
    } catch (e) {
      setError(friendlyAuthError(e));
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
        <Text style={s.heading}>Set a new password</Text>
        <Text style={s.subheading}>Choose a new password for your account.</Text>

        <View style={s.form}>
          <View style={s.field}>
            <Text style={s.label}>New password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(''); }}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              placeholderTextColor={colours.textMuted}
              secureTextEntry
              autoComplete="new-password"
              autoFocus
              accessibilityLabel="New password"
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Confirm new password</Text>
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={(t) => { setConfirm(t); setError(''); }}
              placeholder="••••••••"
              placeholderTextColor={colours.textMuted}
              secureTextEntry
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleSave}
              accessibilityLabel="Confirm new password"
            />
          </View>

          {error !== '' && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, loading && s.btnDisabled]}
            onPress={handleSave}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>{loading ? 'Saving…' : 'Save password'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.linkBtn}
            onPress={abandonPasswordRecovery}
            disabled={loading}
          >
            <Text style={s.linkText}>Cancel and sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
