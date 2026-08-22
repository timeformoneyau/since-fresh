import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getUser, signOut, deleteAccount } from '../domain/auth/service';
import { syncNow, SyncOutcome } from '../domain/sync/engine';
import { hasPending } from '../domain/sync/queue';
import { colours } from '../components/colours';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Account'>;

export default function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  useEffect(() => {
    getUser().then((u) => setEmail(u?.email ?? '')).catch(() => {});
    hasPending().then(setPending).catch(() => {});
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    setSyncNote('');
    const outcome: SyncOutcome = await syncNow();
    setPending(await hasPending().catch(() => false));
    setSyncNote(
      outcome === 'synced'
        ? 'Everything is up to date.'
        : outcome === 'offline'
        ? "Couldn't reach the server — your changes are saved here and will sync later."
        : 'Sync is not set up.',
    );
    setSyncing(false);
  }

  function handleSignOut() {
    Alert.alert(
      'Sign out',
      pending
        ? 'Some changes have not synced yet. Sign out anyway?'
        : 'Sign out of Since?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => { signOut().catch(() => {}); },
        },
      ],
    );
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and everything stored in the cloud. Items already on this device stay here. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Deleting your account cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete permanently',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteAccount();
                    } catch (e) {
                      Alert.alert(
                        "Couldn't delete account",
                        e instanceof Error ? e.message : 'Please try again.',
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email}>{email || '—'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Sync</Text>
        <Text style={styles.body}>
          {pending
            ? 'Some changes are waiting to sync.'
            : 'No changes waiting.'}
        </Text>
        <TouchableOpacity
          style={styles.rowButton}
          onPress={handleSyncNow}
          disabled={syncing}
          accessibilityRole="button"
        >
          {syncing
            ? <ActivityIndicator color={colours.textPrimary} />
            : <Text style={styles.rowButtonText}>Sync now</Text>}
        </TouchableOpacity>
        {syncNote !== '' && <Text style={styles.note}>{syncNote}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Account</Text>
        <TouchableOpacity
          style={styles.rowButton}
          onPress={() => navigation.navigate('ChangePassword')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Change password</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowButton}
          onPress={handleSignOut}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={handleDeleteAccount}
        accessibilityRole="button"
      >
        <Text style={styles.deleteBtnText}>Delete account</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.background },
  content: { padding: 20, paddingBottom: 60 },
  section: { marginBottom: 28 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  email: { fontSize: 16, color: colours.textPrimary, fontWeight: '500' },
  body: { fontSize: 14, color: colours.textSecondary, marginBottom: 10 },
  note: { fontSize: 13, color: colours.textSecondary, marginTop: 8, lineHeight: 18 },
  rowButton: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  rowButtonText: { fontSize: 15, color: colours.textPrimary },
  deleteBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  deleteBtnText: { fontSize: 14, color: colours.destructive, fontWeight: '500' },
});
