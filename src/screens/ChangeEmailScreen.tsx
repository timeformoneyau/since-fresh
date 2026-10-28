import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getSignedInUser, requestEmailChange } from '../domain/auth/service';
import { friendlyAuthError } from '../domain/auth/errors';
import { colours, fonts } from '../theme/tokens';
import KeyboardSafeView from '../components/KeyboardSafeView';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ChangeEmail'>;

/**
 * Change email (F10). Sends a code to the new address; the shared code screen
 * confirms it. The address only changes once the code is accepted.
 */
export default function ChangeEmailScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [currentEmail, setCurrentEmail] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSignedInUser().then((u) => setCurrentEmail(u?.email ?? '')).catch(() => {});
  }, []);

  async function handleSend() {
    const newEmail = email.trim().toLowerCase();
    if (!newEmail) {
      setError('Enter your new email address.');
      return;
    }
    if (newEmail === currentEmail.toLowerCase()) {
      setError("That's already your email address.");
      return;
    }
    setError('');
    setLoading(true);
    try {
      await requestEmailChange(newEmail);
      navigation.navigate('EnterCode', { email: newEmail, purpose: 'email_change' });
    } catch (e) {
      setError(friendlyAuthError(e, 'change-email'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardSafeView style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 60 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>
          {currentEmail
            ? `You're signed in as ${currentEmail}. We'll send a code to your new address to confirm it.`
            : "We'll send a code to your new address to confirm it."}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>New email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(t) => { setEmail(t); setError(''); }}
            placeholder="you@example.com"
            placeholderTextColor={colours.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="done"
            onSubmitEditing={handleSend}
            accessibilityLabel="New email"
          />
        </View>

        {error !== '' && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.saveBtn, loading && styles.btnDisabled]}
          onPress={handleSend}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.saveBtnText}>{loading ? 'Sending…' : 'Send code'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  content: { padding: 20, paddingBottom: 60, gap: 20 },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colours.textSecondary, lineHeight: 20 },
  field: { gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: fonts.regular, fontSize: 15,
    color: colours.textPrimary,
  },
  errorText: { fontFamily: fonts.regular, fontSize: 13, color: colours.destructive },
  saveBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 15, fontFamily: fonts.semibold },
});
