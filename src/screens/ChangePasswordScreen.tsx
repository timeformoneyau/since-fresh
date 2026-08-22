import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { updatePassword } from '../domain/auth/service';
import { colours } from '../components/colours';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ChangePassword'>;

const MIN_PASSWORD_LENGTH = 6;

export default function ChangePasswordScreen() {
  const navigation = useNavigation<Nav>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      await updatePassword(password);
      Alert.alert('Password changed', 'Your new password is set.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change your password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={styles.label}>New password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(''); }}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            placeholderTextColor={colours.textMuted}
            secureTextEntry
            autoComplete="new-password"
            accessibilityLabel="New password"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirm new password</Text>
          <TextInput
            style={styles.input}
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

        {error !== '' && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.saveBtn, loading && styles.btnDisabled]}
          onPress={handleSave}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.saveBtnText}>{loading ? 'Saving…' : 'Save password'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  content: { padding: 20, paddingBottom: 60, gap: 20 },
  field: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '600',
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
    fontSize: 15,
    color: colours.textPrimary,
  },
  errorText: { fontSize: 13, color: colours.destructive },
  saveBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
