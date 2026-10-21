import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SinceItem, RootStackParamList } from '../types';
import { DerivedItem } from '../domain/items/types';
import {
  getDerivedItems,
  markItemDone,
  undoMarkDone,
  deleteItem,
  restoreDeletedItem,
  onItemsChanged,
} from '../domain/items/service';
import { sortItems } from '../utils/statusUtils';
import { isCloudSyncConfigured } from '../lib/supabase';
import { syncNow } from '../domain/sync/engine';
import ItemCard from '../components/ItemCard';
import { useToast } from '../components/Toast';
import SystemStatus from '../components/SystemStatus';
import LogoMark from '../components/LogoMark';
import { useHousehold } from '../components/useHousehold';
import { useSyncOnResume } from '../components/useSyncOnResume';
import { filterItems, canDelete, type ListFilter } from '../domain/household/service';
import { colours, palette, fonts, type, radius, space, TAP } from '../theme/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
const QUICK_START = [
  { name: 'Dentist', category: 'Health' },
  { name: 'Tyre rotation', category: 'Auto' },
  { name: 'Air filter', category: 'Household' },
  { name: 'Smoke alarm', category: 'Household' },
];

export default function MainListScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<DerivedItem[]>([]);
  const [filter, setFilter] = useState<ListFilter>('all');
  const household = useHousehold();
  const showToast = useToast();
  // The filter only exists while in a household
  const shown = household.household ? filterItems(items, filter) : items;

  const refresh = useCallback(async () => {
    setItems(await getDerivedItems());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // Opportunistic sync: reconcile with the cloud whenever the list comes
      // back into view, then re-render if anything changed. No-ops when
      // signed out or unconfigured.
      void syncNow().then((outcome) => {
        if (outcome === 'synced') refresh();
      });
    }, [refresh]),
  );

  // Back from the background: fresh dates, then a quiet sync
  useSyncOnResume(refresh, refresh, (message) => showToast({ message }));

  // Picks up undo actions taken from a toast while this screen is showing
  useEffect(() => onItemsChanged(refresh), [refresh]);

  async function handleMarkDone(item: SinceItem) {
    const previousLastDoneDate = item.lastDoneDate;
    let entryId: string | null;
    try {
      ({ entryId } = await markItemDone(item.id));
    } catch {
      refresh();
      showToast({ message: "Couldn't save that. Please try again." });
      return;
    }
    refresh();
    if (!entryId) {
      showToast({ message: `${item.name} is already marked as done today` });
      return;
    }
    showToast({
      message: `${item.name} marked as done`,
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await undoMarkDone(item.id, entryId, previousLastDoneDate);
        } catch {
          showToast({ message: "Couldn't undo. Please try again." });
        }
      },
    });
  }

  async function handleDelete(item: SinceItem) {
    let removed: SinceItem | null;
    try {
      removed = await deleteItem(item.id);
    } catch {
      refresh();
      showToast({ message: "Couldn't delete that. Please try again." });
      return;
    }
    refresh();
    if (!removed) return;
    showToast({
      message: `${removed.name} deleted`,
      actionLabel: 'Undo',
      onAction: async () => {
        try {
          await restoreDeletedItem(removed);
        } catch {
          showToast({ message: "Couldn't undo. Please try again." });
        }
      },
    });
  }

  function handleEdit(item: SinceItem) {
    navigation.navigate('Edit', { itemId: item.id });
  }

  function handleOpenDetail(item: SinceItem) {
    navigation.navigate('Detail', { itemId: item.id });
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={[styles.headerRow, styles.headerRowTop]}>
        <View style={styles.brand}>
          <LogoMark size={38} />
          <Text style={styles.wordmark}>Since</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Always shown: reminder time and the backup file work without an account */}
          <TouchableOpacity
            style={styles.accountBtn}
            testID="main-account-button"
            onPress={() => navigation.navigate('Account')}
            accessibilityLabel={isCloudSyncConfigured() ? 'Account' : 'Settings'}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="account-outline" size={24} color={palette.ringPale} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            testID="main-add-button"
            onPress={() => navigation.navigate('Add')}
            accessibilityLabel="Add something"
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="plus" size={26} color={palette.ink} />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.tagline}>Know how long it's been.</Text>
    </View>
  );

  if (items.length === 0) {
    return (
      <View style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={palette.navy} />
        {header}
        <View style={styles.emptyContainer}>
          <Text style={styles.appSupport}>
            Track the things you don't do often enough and we'll keep count for you.
          </Text>

          <TouchableOpacity
            style={styles.primaryCTA}
            testID="empty-add-button"
            onPress={() => navigation.navigate('Add')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryCTAText}>Add something</Text>
          </TouchableOpacity>

          <Text style={styles.quickStartLabel}>Quick start</Text>
          <View style={styles.quickStartRow}>
            {QUICK_START.map((q) => (
              <TouchableOpacity
                key={q.name}
                style={styles.chip}
                onPress={() => navigation.navigate('Add')}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>{q.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={palette.navy} />
      <FlatList<DerivedItem>
        data={sortItems(shown) as DerivedItem[]}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            {header}
            <View style={styles.summaryOverlap}>
              <SystemStatus items={shown} />
            </View>
            {household.household && (
              <View style={styles.filterRow} accessibilityRole="tablist">
                {(['all', 'mine', 'household'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterChip, filter === f && styles.filterChipOn]}
                    onPress={() => setFilter(f)}
                    testID={`main-filter-${f}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: filter === f }}
                  >
                    <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>
                      {f === 'all' ? 'All' : f === 'mine' ? 'Just me' : 'Household'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            onMarkDone={handleMarkDone}
            onEdit={handleEdit}
            onDelete={canDelete(item, household) ? handleDelete : undefined}
            onPress={handleOpenDetail}
            snoozedUntil={item.snoozedUntil}
          />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: space.screen,
    marginBottom: space.cardGap,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: palette.infoBg,
  },
  filterChipOn: { backgroundColor: palette.navy },
  filterText: { fontFamily: fonts.semibold, fontSize: 13, color: palette.navy },
  filterTextOn: { color: '#fff' },
  safe: {
    flex: 1,
    backgroundColor: colours.background,
  },

  // Header band
  header: {
    backgroundColor: palette.navy,
    paddingHorizontal: space.screen + 4,
    paddingBottom: 76,
    borderBottomLeftRadius: radius.header,
    borderBottomRightRadius: radius.header,
  },
  headerRowTop: {
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wordmark: {
    ...type.wordmark,
  },
  tagline: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: palette.onNavyMuted,
    marginTop: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.ice,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountBtn: {
    width: TAP,
    height: TAP,
    borderRadius: TAP / 2,
    borderWidth: 1.5,
    borderColor: palette.ringPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryOverlap: {
    marginTop: -44,
  },

  list: {
    paddingBottom: 32,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    paddingHorizontal: space.screen + 4,
    paddingTop: 28,
  },
  appSupport: {
    ...type.body,
    color: palette.muted,
    lineHeight: 24,
    marginBottom: 24,
  },
  primaryCTA: {
    backgroundColor: palette.navy,
    minHeight: 54,
    paddingHorizontal: 28,
    borderRadius: radius.button,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginBottom: 36,
  },
  primaryCTAText: {
    ...type.button,
    color: '#FFFFFF',
  },
  quickStartLabel: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: palette.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  quickStartRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    minHeight: TAP,
    justifyContent: 'center',
    backgroundColor: palette.card,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: palette.ink,
  },
});
