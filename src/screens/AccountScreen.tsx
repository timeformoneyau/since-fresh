import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { getUser, signOut, deleteAccount } from '../domain/auth/service';
import { syncNow, SyncOutcome } from '../domain/sync/engine';
import { hasPending } from '../domain/sync/queue';
import { loadLastSyncedAt } from '../domain/sync/lastSynced';
import { describeLastBackup, describeSyncOutcome } from '../domain/sync/backupStatus';
import { friendlyAuthError } from '../domain/auth/errors';
import { colours, fonts } from '../theme/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Account'>;

export default function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [preparingSignOut, setPreparingSignOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // On focus, so a confirmed email change shows on returning here.
  useFocusEffect(
    useCallback(() => {
      getUser().then((u) => setEmail(u?.email ?? '')).catch(() => {});
      hasPending().then(setPending).catch(() => {});
      loadLastSyncedAt().then(setLastSyncedAt).catch(() => {});
    }, []),
  );

  async function handleSyncNow() {
    setSyncing(true);
    setSyncNote('');
    const outcome: SyncOutcome = await syncNow();
    // On 'signed-out' the app is already moving to Sign in, which explains.
    if (outcome === 'signed-out') return;
    setPending(await hasPending().catch(() => false));
    setLastSyncedAt(await loadLastSyncedAt().catch(() => null));
    setSyncNote(describeSyncOutcome(outcome));
    setSyncing(false);
  }

  async function handleSignOut() {
    // Final sync first (decision D3), then warn using what is still queued
    // afterwards, since signing out removes the list from this phone.
    setPreparingSignOut(true);
    await syncNow();
    const stillPending = await hasPending().catch(() => false);
    setPending(stillPending);
    setPreparingSignOut(false);

    Alert.alert(
      'Sign out',
      stillPending
        ? "Some changes haven't synced yet. Signing out removes your list from this phone, so those changes will be lost. Sign out anyway?"
        : 'Your list is backed up. Signing out removes it from this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (e) {
              Alert.alert("Couldn't sign out", friendlyAuthError(e));
            }
          },
        },
      ],
    );
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      "This permanently deletes your account and your backed-up list, and removes the list from this phone. This can't be undone.",
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
                    setDeleting(true);
                    try {
                      // On success the session ends and the app leaves this
                      // screen, so deleting is not reset.
                      await deleteAccount();
                    } catch (e) {
                      // Nothing was deleted or wiped (auth/service.ts).
                      setDeleting(false);
                      Alert.alert("Couldn't delete account", friendlyAuthError(e));
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
        <Text style={styles.label}>Backup</Text>
        <Text style={styles.body}>
          {describeLastBackup(lastSyncedAt, new Date())}
          {pending ? '. Some changes are waiting to back up.' : '.'}
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
          onPress={() => navigation.navigate('ChangeEmail')}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Change email</Text>
        </TouchableOpacity>
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
          disabled={preparingSignOut}
          accessibilityRole="button"
        >
          {preparingSignOut
            ? <ActivityIndicator color={colours.textPrimary} />
            : <Text style={styles.rowButtonText}>Sign out</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.deleteBtn, deleting && styles.btnDisabled]}
        onPress={handleDeleteAccount}
        disabled={deleting}
        accessibilityRole="button"
      >
        {deleting
          ? <ActivityIndicator color={colours.destructive} />
          : <Text style={styles.deleteBtnText}>Delete account</Text>}
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
    fontFamily: fonts.semibold,
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  email: { fontSize: 16, color: colours.textPrimary, fontFamily: fonts.medium },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colours.textSecondary, marginBottom: 10 },
  note: { fontFamily: fonts.regular, fontSize: 13, color: colours.textSecondary, marginTop: 8, lineHeight: 18 },
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
  rowButtonText: { fontFamily: fonts.regular, fontSize: 15, color: colours.textPrimary },
  deleteBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  deleteBtnText: { fontSize: 14, color: colours.destructive, fontFamily: fonts.medium },
  btnDisabled: { opacity: 0.5 },
});
