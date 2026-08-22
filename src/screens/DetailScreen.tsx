import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, CompletionEvent } from '../types';
import { DerivedItem } from '../domain/items/types';
import { getDerivedItemById, markItemDone } from '../domain/items/service';
import { secondaryLine } from '../utils/statusUtils';
import { humaniseDaysSince, parseDate, formatDisplay, getDaysSince } from '../utils/dateUtils';
import { colours, statusColour } from '../components/colours';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Detail'>;
type Route = RouteProp<RootStackParamList, 'Detail'>;

/**
 * Mean interval between consecutive completions, in days.
 * Needs at least two entries to describe a gap. Ported from `since`.
 */
function averageGapDays(history: CompletionEvent[]): number | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  let total = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    total += getDaysSince(sorted[i + 1].date) - getDaysSince(sorted[i].date);
  }
  return Math.round(total / (sorted.length - 1));
}

function formatAverage(days: number): string {
  if (days < 14) return `avg. ${days}d`;
  if (days < 60) return `avg. ${Math.round(days / 7)}w`;
  if (days < 730) return `avg. ${Math.round(days / 30)}mo`;
  return `avg. ${Math.round(days / 365)}y`;
}

function gapBetween(olderDate: string, newerDate: string): number {
  return getDaysSince(olderDate) - getDaysSince(newerDate);
}

export default function DetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { itemId } = route.params;
  const [item, setItem] = useState<DerivedItem | null>(null);

  const refresh = useCallback(async () => {
    const derived = await getDerivedItemById(itemId);
    if (!derived) { navigation.goBack(); return; }
    setItem(derived);
  }, [itemId, navigation]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  if (!item) return null;

  const accent = statusColour(item.status.label);
  const avg = averageGapDays(item.history);
  const sorted = [...item.history].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{item.name}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.category}>{item.category}</Text>
        {avg !== null && <Text style={styles.avg}>{formatAverage(avg)}</Text>}
      </View>

      {item.status.label !== null ? (
        <Text style={styles.status}>
          <Text style={{ color: accent }}>{item.status.label}</Text>
          <Text style={styles.dot}>{'  ·  '}</Text>
          <Text>{secondaryLine(item.status)}</Text>
        </Text>
      ) : (
        <Text style={styles.status}>Tracked only</Text>
      )}

      <TouchableOpacity
        style={styles.doneBtn}
        onPress={async () => { await markItemDone(item.id); refresh(); }}
        accessibilityRole="button"
        accessibilityLabel={`Mark ${item.name} done`}
      >
        <Text style={styles.doneBtnText}>Mark done today</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>History</Text>

      {sorted.length === 0 ? (
        <Text style={styles.emptyHistory}>
          {item.expiryDate
            ? 'Food items are replaced by the next scan rather than building up a history.'
            : 'No completions logged yet.'}
        </Text>
      ) : (
        sorted.map((event, i) => {
          const next = sorted[i + 1];
          const gap = next ? gapBetween(next.date, event.date) : null;
          return (
            <View key={event.id} style={styles.historyRow}>
              <View style={styles.historyBullet} />
              <View style={styles.historyBody}>
                <Text style={styles.historyDate}>
                  {formatDisplay(parseDate(event.date))}
                </Text>
                <Text style={styles.historyMeta}>
                  {humaniseDaysSince(getDaysSince(event.date))}
                  {gap !== null && ` · ${gap} days after the previous`}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.background },
  content: { padding: 20, paddingBottom: 60 },
  name: {
    fontSize: 26,
    fontWeight: '700',
    color: colours.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  metaRow: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  category: { fontSize: 13, color: colours.textSecondary },
  avg: { fontSize: 13, color: colours.textMuted },
  status: { fontSize: 14, color: colours.textMuted, marginBottom: 24 },
  dot: { color: colours.border },
  doneBtn: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 32,
  },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  emptyHistory: {
    fontSize: 14,
    color: colours.textSecondary,
    lineHeight: 20,
  },
  historyRow: { flexDirection: 'row', marginBottom: 18 },
  historyBullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colours.border,
    marginTop: 5,
    marginRight: 12,
  },
  historyBody: { flex: 1 },
  historyDate: { fontSize: 15, color: colours.textPrimary, marginBottom: 2 },
  historyMeta: { fontSize: 13, color: colours.textMuted },
});
