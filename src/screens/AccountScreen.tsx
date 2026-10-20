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
import { getSignedInUser, signOut, deleteAccount } from '../domain/auth/service';
import { takeSignInNotice } from '../domain/auth/sessionNotice';
import { syncNow, SyncOutcome } from '../domain/sync/engine';
import { hasPending } from '../domain/sync/queue';
import { loadLastSyncedAt } from '../domain/sync/lastSynced';
import { describeLastBackup, describeSyncOutcome } from '../domain/sync/backupStatus';
import { friendlyAuthError } from '../domain/auth/errors';
import { exportBackup, previewRestore, applyRestore, BackupError } from '../domain/items/service';
import { BACKUP_COPY } from '../domain/backup/backup';
import { shareBackupFile, pickBackupFile } from '../domain/backup/files';
import { isCloudSyncConfigured } from '../lib/supabase';
import { todayString } from '../utils/dateUtils';
import { useToast } from '../components/Toast';
import HouseholdSection from '../components/HouseholdSection';
import { colours, fonts } from '../theme/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Account'>;

/**
 * Backup to a file and restore, with or without an account (sync plan, PR 4).
 * Restoring adds what's missing and never replaces (domain/backup/backup.ts).
 */
function BackupFileSection() {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      await shareBackupFile(await exportBackup(), todayString());
    } catch {
      Alert.alert("Couldn't make a backup", 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    setBusy(true);
    try {
      const raw = await pickBackupFile();
      if (raw === null) return;
      const { backup, message } = await previewRestore(raw);
      if (!message) {
        Alert.alert('Restore from a backup', BACKUP_COPY.nothingNew);
        return;
      }
      Alert.alert('Restore from a backup', message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: async () => {
            try {
              await applyRestore(backup);
              showToast({ message: 'Added to your list.' });
            } catch {
              Alert.alert("Couldn't restore", 'Nothing was changed. Please try again.');
            }
          },
        },
      ]);
    } catch (e) {
      Alert.alert("Couldn't restore", e instanceof BackupError ? e.message : 'Nothing was changed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Backup file</Text>
      <Text style={styles.body}>
        Save a copy of your list as a file, or add one back. Restoring only adds what's missing.
      </Text>
      <TouchableOpacity
        style={[styles.rowButton, busy && styles.btnDisabled]}
        testID="account-export-button"
        onPress={handleExport}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.rowButtonText}>Export a backup</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.rowButton, busy && styles.btnDisabled]}
        testID="account-restore-button"
        onPress={handleRestore}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.rowButtonText}>Restore from a backup</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Signed in: backup status and account actions. Signed out: an invitation to
 * back up. Without cloud sync set up, just the backup file.
 */
export default function AccountScreen() {
  const navigation = useNavigation<Nav>();
  // undefined while loading, null when signed out
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [preparingSignOut, setPreparingSignOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isCloudSyncConfigured()) {
      setUser(null);
      return;
    }
    getSignedInUser()
      .then((u) => {
        setUser(u);
        if (!u) setNotice((n) => takeSignInNotice() ?? n);
      })
      .catch(() => setUser(null));
    hasPending().then(setPending).catch(() => {});
    loadLastSyncedAt().then(setLastSyncedAt).catch(() => {});
  }, []);

  // On focus, so a sign-in or a confirmed email change shows on returning here.
  useFocusEffect(load);

  async function handleSyncNow() {
    setSyncing(true);
    setSyncNote('');
    const outcome: SyncOutcome = await syncNow();
    setSyncing(false);
    if (outcome === 'signed-out') {
      // The session ended; show the signed-out view, which explains.
      load();
      return;
    }
    setPending(await hasPending().catch(() => false));
    setLastSyncedAt(await loadLastSyncedAt().catch(() => null));
    setSyncNote(describeSyncOutcome(outcome));
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
              setSyncNote('');
              setLastSyncedAt(null);
              setUser(null);
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
                      await deleteAccount();
                      setDeleting(false);
                      setUser(null);
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

  if (user === undefined) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={colours.textMuted} />
      </View>
    );
  }

  if (user === null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {isCloudSyncConfigured() && (
        <View style={styles.section}>
          <Text style={styles.label}>Back up and sync</Text>
          {notice !== '' && <Text style={styles.body}>{notice}</Text>}
          <Text style={styles.body}>
            Your list is saved on this phone. Sign in to back it up and keep it on another phone too.
          </Text>
          <TouchableOpacity
            style={styles.rowButton}
            testID="account-sign-in-button"
            onPress={() => navigation.navigate('SignIn')}
            accessibilityRole="button"
          >
            <Text style={styles.rowButtonText}>Sign in or create an account</Text>
          </TouchableOpacity>
        </View>
        )}
        <BackupFileSection />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.email} testID="account-email">{user.email || '—'}</Text>
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

      <HouseholdSection />

      <BackupFileSection />

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
          testID="account-sign-out-button"
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
  centred: { justifyContent: 'center', alignItems: 'center' },
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
  body: { fontFamily: fonts.regular, fontSize: 14, color: colours.textSecondary, marginBottom: 10, lineHeight: 20 },
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
