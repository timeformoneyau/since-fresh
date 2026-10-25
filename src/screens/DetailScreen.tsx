import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar, Switch } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../types';
import { DerivedItem } from '../domain/items/types';
import {
  getDerivedItemById,
  markItemDone,
  undoMarkDone,
  addHistoryEntry,
  usualIntervalDays,
  gapsNewestFirst,
  HistoryError,
  refreshReminders,
  setLookedAfterBy,
  snoozeItem,
  clearSnooze,
  getSyncProblem,
} from '../domain/items/service';
import { canSnooze, snoozeNote, SNOOZE_OPTIONS, type SnoozeOption } from '../domain/snooze/rules';
import { useHousehold } from '../components/useHousehold';
import {
  doneBy,
  isMuted,
  isShared,
  setRemindMe,
  householdErrorMessage,
  canChooseWhoLooksAfter,
  lookAfterChoices,
  lookedAfterBy,
  LOOK_AFTER_COPY,
} from '../domain/household/service';
import {
  repeatText,
  daysAgoText,
  daysAheadText,
  dueCaption,
  entryCaption,
  historySummary,
  dueLine,
  untilText,
  NOT_YET,
  EMPTY_HISTORY,
} from '../domain/items/display';
import { isDateItem, lastDoneOf } from '../domain/items/due';
import { secondaryLine } from '../utils/statusUtils';
import { parseDate, formatDisplay, formatShort, todayString } from '../utils/dateUtils';
import {
  palette,
  colours,
  fonts,
  type,
  radius,
  space,
  cardShadow,
  statusColour,
  TAP,
} from '../theme/tokens';
import { useToast } from '../components/Toast';
import CategoryTile from '../components/CategoryTile';
import StatusChip from '../components/StatusChip';
import DatePickerModal from '../components/DatePickerModal';
import LookAfterChoices from '../components/LookAfterChoices';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Detail'>;
type Route = RouteProp<RootStackParamList, 'Detail'>;

const display = (date: string) => formatDisplay(parseDate(date));

/** The item screen: status, Done today, and the history timeline. */
export default function DetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { itemId } = route.params;
  const [item, setItem] = useState<DerivedItem | null>(null);
  const [pickingPastDate, setPickingPastDate] = useState(false);
  const [changingRemind, setChangingRemind] = useState(false);
  const [changingLookAfter, setChangingLookAfter] = useState(false);
  const [choosingSnooze, setChoosingSnooze] = useState(false);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);
  const household = useHousehold();
  const showToast = useToast();

  async function handleRemindMe(remind: boolean) {
    if (!item) return;
    setChangingRemind(true);
    try {
      await setRemindMe(item, remind);
      await refreshReminders();
    } catch (e) {
      showToast({ message: householdErrorMessage(e) });
    } finally {
      setChangingRemind(false);
    }
  }

  async function handleLookAfter(userId: string | null) {
    if (!item) return;
    setChangingLookAfter(true);
    try {
      // Saved straight away, like "Remind me about this"; reminders re-planned
      await setLookedAfterBy(item.id, userId);
      await refresh();
    } catch {
      showToast({ message: "Couldn't save that. Please try again." });
    } finally {
      setChangingLookAfter(false);
    }
  }

  const refresh = useCallback(async () => {
    const derived = await getDerivedItemById(itemId);
    if (!derived) { navigation.goBack(); return; }
    setItem(derived);
    setSyncProblem(await getSyncProblem(itemId).catch(() => null));
  }, [itemId, navigation]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function handleMarkDone() {
    if (!item) return;
    const previousLastDoneDate = item.lastDoneDate;
    const previousDueDate = item.dueDate ?? null;
    const { entryId } = await markItemDone(item.id);
    refresh();
    if (!entryId) {
      showToast({ message: 'Already marked as done today' });
      return;
    }
    showToast({
      message: 'Marked as done',
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await undoMarkDone(itemId, entryId, previousLastDoneDate, previousDueDate);
          refresh();
        } catch {
          showToast({ message: "Couldn't undo. Please try again." });
        }
      },
    });
  }

  async function handleSnooze(option: SnoozeOption) {
    setChoosingSnooze(false);
    try {
      const until = await snoozeItem(itemId, option);
      refresh();
      showToast({
        message: snoozeNote(until, new Date()) ?? 'Snoozed',
        actionLabel: 'Undo',
        onAction: async () => {
          try {
            await clearSnooze(itemId);
            refresh();
          } catch {
            showToast({ message: "Couldn't undo. Please try again." });
          }
        },
      });
    } catch {
      refresh();
      showToast({ message: "Couldn't snooze that. Please try again." });
    }
  }

  async function handleAddPast(date: string) {
    setPickingPastDate(false);
    try {
      await addHistoryEntry(itemId, date);
      showToast({ message: `Added ${display(date)}` });
      refresh();
    } catch (e) {
      showToast({ message: e instanceof HistoryError ? e.message : "Couldn't add that. Please try again." });
    }
  }

  if (!item) return null;

  const { status } = item;
  // Anything with a due date can be marked done: a repeating item, or a date item
  const repeating = status.label !== null && status.nextDueDate !== null && status.daysUntilDue !== null;
  const dated = isDateItem(item);
  const lastDone = lastDoneOf(item);
  const usual = usualIntervalDays(item);
  const gaps = gapsNewestFirst(item);
  const entries = item.history; // newest first
  const overdue = status.daysUntilDue !== null && status.daysUntilDue <= 0;
  const snoozed = snoozeNote(item.snoozedUntil, new Date());
  const offerSnooze = !item.snoozedUntil && canSnooze(item, new Date());

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={palette.navy} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* Header band */}
        <View style={[styles.band, { paddingTop: insets.top }]}>
          <View style={styles.bandRow}>
            <TouchableOpacity
              style={styles.backLink}
              onPress={() => navigation.goBack()}
              testID="detail-back"
              accessibilityRole="button"
              accessibilityLabel="Back to Since"
            >
              <Text style={styles.backText}>‹ Since</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editPill}
              onPress={() => navigation.navigate('Edit', { itemId: item.id })}
              testID="detail-edit-button"
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.name}`}
            >
              <Text style={styles.editPillText}>Edit</Text>
            </TouchableOpacity>
          </View>
          <CategoryTile name={item.name} category={item.category} size={56} />
          <Text style={styles.title} accessibilityRole="header">{item.name}</Text>
          <Text style={styles.subtitle}>
            {dated ? untilText(item.repeatValue, item.repeatUnit) : repeatText(item.repeatValue, item.repeatUnit)}
          </Text>
        </View>

        {/* Status card */}
        <View style={[styles.card, styles.statusCard]} testID="detail-status-card">
          <View style={styles.statusRow}>
            <StatusChip label={status.label} />
            <Text style={[type.secondary, styles.shrink]}>
              {dated && status.daysUntilDue !== null ? dueLine(status.daysUntilDue) : secondaryLine(status)}
            </Text>
          </View>
          <View style={styles.columns}>
            {lastDone ? (
              <Column heading="Last done" value={formatShort(parseDate(lastDone))} sub={daysAgoText(status.daysSince)} />
            ) : (
              <Column heading="Last done" value={NOT_YET} sub="" testID="detail-last-done" />
            )}
            {status.nextDueDate && status.daysUntilDue !== null && (
              <Column
                heading={overdue ? 'Was due' : 'Next due'}
                value={formatShort(status.nextDueDate)}
                sub={overdue ? daysAgoText(-status.daysUntilDue) : daysAheadText(status.daysUntilDue)}
              />
            )}
            {usual !== null && <Column heading="Usually" value={`${usual} days`} sub="between each" />}
          </View>
        </View>

        {syncProblem && (
          <View style={[styles.card, styles.syncCard]} testID="detail-sync-problem">
            <Text style={styles.syncHeading}>Can't sync yet</Text>
            <Text style={type.secondary}>{syncProblem} It's saved on this phone.</Text>
          </View>
        )}

        <View style={styles.actions}>
          {repeating && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleMarkDone}
              testID="detail-mark-done-button"
              accessibilityRole="button"
              accessibilityLabel={`Mark ${item.name} done today`}
            >
              <Text style={styles.primaryBtnText}>Done today</Text>
            </TouchableOpacity>
          )}
          {snoozed && (
            <Text style={[type.secondary, styles.snoozedText]} testID="detail-snoozed">
              {snoozed}. Reminders start again then.
            </Text>
          )}
          {offerSnooze && !choosingSnooze && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setChoosingSnooze(true)}
              testID="detail-not-yet-button"
              accessibilityRole="button"
              accessibilityLabel={`Not yet: snooze reminders for ${item.name}`}
            >
              <Text style={styles.secondaryBtnText}>Not yet</Text>
            </TouchableOpacity>
          )}
          {offerSnooze && choosingSnooze && (
            <View style={styles.snoozeChoices}>
              <Text style={[type.secondary, styles.snoozedText]}>Remind me again in</Text>
              <View style={styles.snoozeRow}>
                {SNOOZE_OPTIONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={styles.snoozeChip}
                    onPress={() => handleSnooze(o.key)}
                    testID={`snooze-${o.key}`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryBtnText}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.textBtn}
                onPress={() => setChoosingSnooze(false)}
                testID="snooze-cancel"
                accessibilityRole="button"
              >
                <Text style={styles.textBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={styles.textBtn}
            onPress={() => setPickingPastDate(true)}
            testID="detail-add-past-entry"
            accessibilityRole="button"
          >
            <Text style={styles.textBtnText}>
              Did it on another day? <Text style={styles.link}>Add a past entry</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Who looks after this? (shared items: any member can choose) */}
        {canChooseWhoLooksAfter(item, household) && (
          <View style={styles.card} testID="detail-look-after">
            <Text style={[styles.entryDate, styles.lookAfterHeading]}>{LOOK_AFTER_COPY.question}</Text>
            <LookAfterChoices
              prefix="detail"
              choices={lookAfterChoices(household)}
              me={household.userId}
              value={lookedAfterBy(item)}
              onChange={handleLookAfter}
              disabled={changingLookAfter}
            />
          </View>
        )}

        {/* Remind me about this (shared items: each member's own choice) */}
        {isShared(item) && household.household && (
          <View style={[styles.card, styles.remindRow]}>
            <View style={styles.shrink}>
              <Text style={styles.entryDate}>Remind me about this</Text>
              <Text style={type.secondary}>Shared with {household.household.name}. This only changes your reminders.</Text>
            </View>
            <Switch
              value={!isMuted(item, household)}
              onValueChange={handleRemindMe}
              disabled={changingRemind}
              testID="detail-remind-me"
              accessibilityLabel="Remind me about this"
            />
          </View>
        )}

        {/* History */}
        <View style={styles.historyHeader}>
          <Text style={type.sectionHeading} accessibilityRole="header">History</Text>
          <Text style={[type.secondary, styles.shrink, styles.right]} testID="detail-history-summary">
            {historySummary(entries.length, usual)}
          </Text>
        </View>

        <View style={styles.timeline}>
          {repeating && status.nextDueDate && status.daysUntilDue !== null && (
            <TimelineRow dot={<View style={[styles.dueDot, { borderColor: statusColour(status.label) }]} />} first>
              <View style={styles.dueCard} testID="detail-due-marker">
                <Text style={styles.entryDate}>Due {formatDisplay(status.nextDueDate)}</Text>
                <Text style={type.secondary}>
                  {dated ? dueLine(status.daysUntilDue) : dueCaption(status.daysUntilDue, item.repeatValue!, item.repeatUnit!)}
                </Text>
              </View>
            </TimelineRow>
          )}
          {entries.length === 0 && (
            <TimelineRow dot={<View style={styles.olderDot} />} last first={!repeating}>
              <View style={[styles.card, styles.entryCard]} testID="detail-history-empty">
                <Text style={[type.secondary, styles.shrink]}>{EMPTY_HISTORY}</Text>
              </View>
            </TimelineRow>
          )}
          {entries.map((entry, i) => {
            const isLatest = i === 0;
            const isFirstEver = i === entries.length - 1;
            const dot = isLatest ? (
              <View style={styles.latestDotHalo}><View style={styles.latestDot} /></View>
            ) : (
              <View style={[styles.olderDot, isFirstEver && { backgroundColor: palette.iceDeep }]} />
            );
            return (
              <TimelineRow
                key={entry.id}
                dot={dot}
                first={!repeating && i === 0}
                last={isFirstEver}
              >
                <View style={[styles.card, styles.entryCard]} testID={`history-entry-${i}`}>
                  <View style={styles.shrink}>
                    <Text style={styles.entryDate}>{display(entry.date)}</Text>
                    <Text style={type.secondary}>{entryCaption(isFirstEver ? null : gaps[i], dated)}</Text>
                    {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
                    {doneBy(item, entry, household) ? (
                      <Text style={type.secondary} testID={`history-done-by-${i}`}>{doneBy(item, entry, household)}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.pencil}
                    onPress={() => navigation.navigate('EditEntry', { itemId: item.id, entryId: entry.id })}
                    testID={`history-edit-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit the ${display(entry.date)} entry`}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={20} color={palette.navy} />
                  </TouchableOpacity>
                </View>
              </TimelineRow>
            );
          })}
        </View>
      </ScrollView>

      {pickingPastDate && (
        <DatePickerModal
          value={todayString()}
          onConfirm={handleAddPast}
          onCancel={() => setPickingPastDate(false)}
        />
      )}
    </View>
  );
}

function Column({ heading, value, sub, testID }: { heading: string; value: string; sub: string; testID?: string }) {
  return (
    <View style={styles.column} testID={testID}>
      <Text style={styles.columnHeading}>{heading}</Text>
      <Text style={styles.columnValue}>{value}</Text>
      <Text style={type.secondary}>{sub}</Text>
    </View>
  );
}

/** A row on the timeline: the rail with its dot on the left, the content on the right. */
function TimelineRow({
  dot,
  first,
  last,
  children,
}: {
  dot: React.ReactNode;
  first?: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.rail}>
        <View style={[styles.railLine, first && styles.railFromDot, last && styles.railToDot]} />
        <View style={styles.dotSlot}>{dot}</View>
      </View>
      <View style={styles.timelineContent}>{children}</View>
    </View>
  );
}

const DOT_TOP = 22;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.background },
  shrink: { flexShrink: 1 },
  right: { textAlign: 'right' },

  band: {
    backgroundColor: palette.navy,
    paddingHorizontal: space.screen + 4,
    paddingBottom: 76,
    borderBottomLeftRadius: radius.header,
    borderBottomRightRadius: radius.header,
  },
  bandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    marginBottom: 16,
  },
  backLink: { minHeight: TAP, justifyContent: 'center', paddingRight: 12 },
  backText: { fontFamily: fonts.semibold, fontSize: 16.5, color: palette.ringPale },
  editPill: {
    minHeight: TAP,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  editPillText: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  title: { ...type.screenTitle, color: '#FFFFFF', marginTop: 14 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, color: palette.onNavyMuted, marginTop: 2 },

  card: {
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    ...cardShadow,
  },
  statusCard: { marginHorizontal: space.screen, marginTop: -44 },
  syncCard: { marginHorizontal: space.screen, marginTop: 12 },
  syncHeading: { fontFamily: fonts.semibold, fontSize: 15, color: palette.ink, marginBottom: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  columns: { flexDirection: 'row', marginTop: 16, gap: 12 },
  column: { flex: 1 },
  columnHeading: { fontFamily: fonts.semibold, fontSize: 12.5, color: palette.muted, marginBottom: 2 },
  columnValue: { fontFamily: fonts.bold, fontSize: 17, color: palette.ink },

  actions: { paddingHorizontal: space.screen, marginTop: 16 },
  primaryBtn: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...type.button, color: '#FFFFFF' },
  textBtn: { minHeight: TAP, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  secondaryBtn: {
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: { fontFamily: fonts.semibold, fontSize: 15, color: palette.ink },
  snoozedText: { textAlign: 'center', marginTop: 10 },
  snoozeChoices: { marginTop: 6 },
  snoozeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  snoozeChip: {
    flex: 1,
    minHeight: TAP,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textBtnText: { fontFamily: fonts.regular, fontSize: 14.5, color: palette.muted, textAlign: 'center' },
  link: { fontFamily: fonts.bold, color: palette.navy },

  historyHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: space.screen + 4,
    marginTop: 24,
    marginBottom: 8,
  },

  timeline: { paddingHorizontal: space.screen },
  timelineRow: { flexDirection: 'row' },
  rail: { width: 28, alignItems: 'center' },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: palette.line },
  railFromDot: { top: DOT_TOP },
  railToDot: { bottom: undefined, height: DOT_TOP },
  dotSlot: { height: 2 * DOT_TOP, justifyContent: 'center' },
  timelineContent: { flex: 1, paddingLeft: 8, paddingBottom: space.cardGap },

  dueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, backgroundColor: palette.ground },
  latestDotHalo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.lineHalo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  latestDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: palette.navy },
  olderDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: palette.navy },

  dueCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.line,
    borderRadius: radius.card,
    padding: space.cardPadding,
  },
  lookAfterHeading: { marginBottom: 10 },
  remindRow: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  entryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  entryDate: { fontFamily: fonts.bold, fontSize: 16.5, color: palette.ink },
  note: { fontFamily: fonts.regular, fontSize: 14, color: palette.ink, marginTop: 4 },
  pencil: {
    width: TAP,
    height: TAP,
    borderRadius: TAP / 2,
    backgroundColor: palette.iconBtnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
