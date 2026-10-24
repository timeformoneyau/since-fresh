import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { format } from 'date-fns';
import {
  inviteCode,
  getActiveInvite,
  replaceInvite,
  revokeInvites,
  leaveHousehold,
  removeMember,
  transferOwnership,
  deleteHousehold,
  householdErrorMessage,
  isHouseholdOwner,
  type Member,
  type Invite,
} from '../domain/household/service';
import { syncNow } from '../domain/sync/engine';
import { SUPPORT_EMAIL, HOUSEHOLD_RULES, reportProblemUrl } from '../domain/household/report';
import { useHousehold } from './useHousehold';
import { colours, fonts } from '../theme/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Account'>;

/** "Fri 30 Oct" */
const untilText = (invite: Invite) => format(new Date(invite.expiresAt), 'EEE d MMM');

/** Account → Household (sync plan, PR 6). Only shown when signed in. */
export default function HouseholdSection() {
  const navigation = useNavigation<Nav>();
  const state = useHousehold();
  const [busy, setBusy] = useState(false);
  const { household, userId } = state;
  const owner = isHouseholdOwner(state);
  const householdId = household?.id ?? null;
  // The owner's code waiting to be used, if any (undefined until read)
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);

  const loadInvite = useCallback(async () => {
    if (!owner || !householdId) { setInvite(null); return; }
    setInvite(await getActiveInvite(householdId).catch(() => undefined));
  }, [owner, householdId]);

  useEffect(() => { void loadInvite(); }, [loadInvite]);

  /** Run a membership change, then sync so the list and household catch up. */
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await syncNow();
    } catch (e) {
      Alert.alert("Couldn't do that", householdErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function shareCode(code: string) {
    Share.share({ message: `Join my household on Since. In the app, go to Account → Join a household and enter ${code}` })
      .catch(() => {});
  }

  function showCode(code: Invite) {
    Alert.alert(
      'Invite someone',
      `Give them this code: ${code.code}\n\nThey enter it in Since under Account → Join a household. It works until ${untilText(code)}.`,
      [
        { text: 'Done', style: 'cancel' },
        { text: 'Share', onPress: () => shareCode(code.code) },
      ],
    );
  }

  /** The code already waiting if there is one, so each tap doesn't make another. */
  async function handleInvite() {
    if (!householdId) return;
    setBusy(true);
    try {
      const code = await inviteCode(householdId);
      setInvite(code);
      showCode(code);
    } catch (e) {
      Alert.alert("Couldn't make a code", householdErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleNewCode() {
    if (!householdId) return;
    Alert.alert(
      'Make a new code?',
      "The code you have now stops working. Anyone who hasn't joined yet will need the new one.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make a new code',
          onPress: async () => {
            setBusy(true);
            try {
              const code = await replaceInvite(householdId);
              setInvite(code);
              showCode(code);
            } catch (e) {
              Alert.alert("Couldn't make a code", householdErrorMessage(e));
              void loadInvite();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function handleStopCode() {
    if (!householdId) return;
    Alert.alert(
      'Turn off this code?',
      'Nobody new can join with it. You can make a new one whenever you want to invite someone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await revokeInvites(householdId);
              setInvite(null);
            } catch (e) {
              Alert.alert("Couldn't turn off the code", householdErrorMessage(e));
              void loadInvite();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  /** Removing someone also stops the household's codes (006_play_hardening.sql). */
  async function handleRemove(member: Member) {
    setBusy(true);
    try {
      await removeMember(member.userId);
      setInvite(null);
      await syncNow();
      Alert.alert(
        `${member.displayName} has been removed`,
        "Any invite code you'd shared has stopped working too, so they can't use it to join again. To invite someone else, make a new code.",
      );
    } catch (e) {
      Alert.alert("Couldn't do that", householdErrorMessage(e));
    } finally {
      setBusy(false);
      void loadInvite();
    }
  }

  function handleMember(member: Member) {
    if (!owner || member.userId === userId) return;
    Alert.alert(member.displayName, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Make owner',
        onPress: () =>
          Alert.alert(
            `Make ${member.displayName} the owner?`,
            "They'll be able to invite and remove people. You'll stay in the household.",
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Make owner', onPress: () => run(() => transferOwnership(member.userId)) },
            ],
          ),
      },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            `Remove ${member.displayName}?`,
            "Items they shared stay with the household. Their own items stay theirs.",
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => handleRemove(member) },
            ],
          ),
      },
    ]);
  }

  function handleLeave() {
    Alert.alert(
      'Leave household?',
      'Items you shared stay with the household. Your own items stay on this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => run(leaveHousehold) },
      ],
    );
  }

  function handleDelete() {
    Alert.alert(
      'Delete household?',
      'Shared items become your own items again. Nothing is lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run(deleteHousehold) },
      ],
    );
  }

  /** Opens an email to support; says where to write if there's no email app. */
  function handleReport(url: string) {
    Linking.openURL(url).catch(() => {
      Alert.alert('No email app found', `Email ${SUPPORT_EMAIL.trim()} and say what happened and who or what it's about.`);
    });
  }

  if (!household) {
    return (
      <View style={styles.section}>
        <Text style={styles.label}>Household</Text>
        <Text style={styles.body}>
          Share items with the people you live with. Each item stays just yours unless you choose Household.
        </Text>
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-create-button"
          onPress={() => navigation.navigate('HouseholdSetup', { mode: 'create' })}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Create a household</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-join-button"
          onPress={() => navigation.navigate('HouseholdSetup', { mode: 'join' })}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Join a household</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const alone = household.members.length <= 1;
  // Hidden until there's an address to send reports to (report.ts)
  const reportUrl = reportProblemUrl(SUPPORT_EMAIL, household);

  return (
    <View style={styles.section} testID="household-section">
      <Text style={styles.label}>Household</Text>
      <Text style={styles.name}>{household.name}</Text>
      {household.members.map((m) => (
        <TouchableOpacity
          key={m.userId}
          style={styles.memberRow}
          onPress={() => handleMember(m)}
          disabled={!owner || m.userId === userId || busy}
          testID={`household-member-${m.displayName}`}
          accessibilityRole={owner && m.userId !== userId ? 'button' : 'text'}
        >
          <Text style={styles.rowButtonText}>
            {m.displayName}{m.userId === userId ? ' (you)' : ''}
          </Text>
          {m.role === 'owner' && <Text style={styles.note}>Owner</Text>}
        </TouchableOpacity>
      ))}

      {owner && invite && (
        <View style={styles.invite} testID="household-invite-code">
          <Text style={styles.note}>Invite code</Text>
          <Text style={styles.code} selectable>{invite.code}</Text>
          <Text style={styles.note}>Works until {untilText(invite)}. Anyone with it can join.</Text>
        </View>
      )}
      {owner && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-invite-button"
          onPress={invite ? () => shareCode(invite.code) : handleInvite}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>{invite ? 'Share the code' : 'Invite someone'}</Text>
        </TouchableOpacity>
      )}
      {owner && invite && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-new-code-button"
          onPress={handleNewCode}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Make a new code</Text>
        </TouchableOpacity>
      )}
      {owner && invite && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-stop-code-button"
          onPress={handleStopCode}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Turn off this code</Text>
        </TouchableOpacity>
      )}
      {!owner && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-leave-button"
          onPress={handleLeave}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.rowButtonText}>Leave household</Text>
        </TouchableOpacity>
      )}
      {owner && alone && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-delete-button"
          onPress={handleDelete}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[styles.rowButtonText, styles.danger]}>Delete household</Text>
        </TouchableOpacity>
      )}
      {owner && !alone && (
        <Text style={styles.note}>
          To leave, tap someone and make them the owner first. Tap a person to remove them.
        </Text>
      )}

      <Text style={[styles.note, styles.rules]} testID="household-rules">{HOUSEHOLD_RULES}</Text>
      {reportUrl && (
        <TouchableOpacity
          style={styles.rowButton}
          testID="household-report-button"
          onPress={() => handleReport(reportUrl)}
          accessibilityRole="link"
        >
          <Text style={styles.rowButtonText}>Report a problem</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 28 },
  label: {
    fontSize: 11,
    fontFamily: fonts.semibold,
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  invite: { marginTop: 12, marginBottom: 4 },
  code: { fontSize: 22, fontFamily: fonts.semibold, color: colours.textPrimary, letterSpacing: 2, marginVertical: 2 },
  name: { fontSize: 16, color: colours.textPrimary, fontFamily: fonts.medium, marginBottom: 8 },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colours.textSecondary, marginBottom: 10, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 13, color: colours.textSecondary, lineHeight: 18 },
  memberRow: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colours.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  rowButton: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: colours.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colours.border,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  rowButtonText: { fontFamily: fonts.regular, fontSize: 15, color: colours.textPrimary },
  danger: { color: colours.destructive },
  rules: { marginTop: 16 },
});
