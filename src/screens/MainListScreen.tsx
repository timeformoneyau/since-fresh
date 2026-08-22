import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SinceItem, RootStackParamList, DEFAULT_CATEGORIES } from '../types';
import { DerivedItem } from '../domain/items/types';
import { getDerivedItems, markItemDone, deleteItem } from '../domain/items/service';
import { sortItems, computeItemStatus, statusSortOrder } from '../utils/statusUtils';
import { isCloudSyncConfigured } from '../lib/supabase';
import { syncNow } from '../domain/sync/engine';
import ItemCard from '../components/ItemCard';
import SystemStatus from '../components/SystemStatus';
import { colours } from '../components/colours';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Section = { title: string; data: DerivedItem[] };

/**
 * Group items into per-category sections.
 *
 * Category grouping nests urgency sorting rather than replacing it:
 *   - items within a section keep the existing sortItems() urgency order
 *   - sections are ordered by the urgency of their most-urgent item, so the
 *     category that needs attention floats to the top
 *   - DEFAULT_CATEGORIES order breaks ties between equally-urgent sections
 */
function buildSections(items: DerivedItem[]): Section[] {
  const map = new Map<string, DerivedItem[]>();
  for (const item of items) {
    const cat = item.category || 'Other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(item);
  }

  const sections: Array<Section & { urgency: number; catOrder: number }> = [];
  for (const [title, data] of map.entries()) {
    const sorted = sortItems(data) as DerivedItem[];
    const urgency = statusSortOrder(computeItemStatus(sorted[0]).label);
    const catOrder = (DEFAULT_CATEGORIES as readonly string[]).indexOf(title);
    sections.push({
      title,
      data: sorted,
      urgency,
      catOrder: catOrder === -1 ? DEFAULT_CATEGORIES.length : catOrder,
    });
  }

  sections.sort((a, b) => a.urgency - b.urgency || a.catOrder - b.catOrder);

  return sections.map(({ title, data }) => ({ title, data }));
}

const QUICK_START = [
  { name: 'Dentist', category: 'Health' },
  { name: 'Tyre rotation', category: 'Auto' },
  { name: 'Air filter', category: 'Household' },
  { name: 'Smoke alarm', category: 'Household' },
];

export default function MainListScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<DerivedItem[]>([]);

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

  async function handleMarkDone(item: SinceItem) {
    await markItemDone(item.id);
    refresh();
  }

  async function handleDelete(item: SinceItem) {
    await deleteItem(item.id);
    refresh();
  }

  function handleEdit(item: SinceItem) {
    navigation.navigate('Edit', { itemId: item.id });
  }

  function handleOpenDetail(item: SinceItem) {
    navigation.navigate('Detail', { itemId: item.id });
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={colours.background} />
        <View style={styles.emptyContainer}>
          <Text style={styles.appTitle}>Since</Text>
          <Text style={styles.appTagline}>Know how long it's been</Text>
          <Text style={styles.appSupport}>
            Track the things you don't do often enough and we'll keep count for you.
          </Text>

          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={styles.primaryCTA}
              onPress={() => navigation.navigate('Add')}
            >
              <Text style={styles.primaryCTAText}>Add something</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryCTA}
              onPress={() => navigation.navigate('ScanFood')}
            >
              <Text style={styles.secondaryCTAText}>📷 Scan food</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.quickStartLabel}>Quick start</Text>
          <View style={styles.quickStartRow}>
            {QUICK_START.map((q) => (
              <TouchableOpacity
                key={q.name}
                style={styles.chip}
                onPress={() => navigation.navigate('Add')}
              >
                <Text style={styles.chipText}>{q.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={colours.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Since</Text>
        <View style={styles.headerActions}>
          {isCloudSyncConfigured() && (
            <TouchableOpacity
              style={styles.accountBtn}
              onPress={() => navigation.navigate('Account')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Account"
              accessibilityRole="button"
            >
              <Text style={styles.accountBtnText}>Account</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.scanBtn}
            onPress={() => navigation.navigate('ScanFood')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Scan food"
            accessibilityRole="button"
          >
            <Text style={styles.scanBtnText}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate('Add')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Add something"
            accessibilityRole="button"
          >
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SystemStatus items={items} />

      <SectionList<DerivedItem>
        sections={buildSections(items)}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            onMarkDone={handleMarkDone}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onPress={item.expiryDate ? undefined : handleOpenDetail}
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colours.background,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  appTitle: {
    fontSize: 42,
    fontWeight: '700',
    color: colours.textPrimary,
    letterSpacing: -1,
    marginBottom: 6,
  },
  appTagline: {
    fontSize: 20,
    fontWeight: '400',
    color: colours.textPrimary,
    marginBottom: 16,
  },
  appSupport: {
    fontSize: 15,
    color: colours.textSecondary,
    lineHeight: 22,
    marginBottom: 40,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 40,
  },
  primaryCTA: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  primaryCTAText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryCTA: {
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  secondaryCTAText: {
    color: colours.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  quickStartLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colours.textMuted,
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
    borderColor: colours.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colours.surface,
  },
  chipText: {
    fontSize: 13,
    color: colours.textSecondary,
  },

  // List header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colours.textPrimary,
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  scanBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanBtnText: {
    fontSize: 16,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colours.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 22,
    marginTop: -1,
  },

  list: {
    paddingBottom: 32,
  },
  accountBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colours.surface,
    borderWidth: 1,
    borderColor: colours.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountBtnText: {
    fontSize: 13,
    color: colours.textSecondary,
    fontWeight: '500',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 6,
    backgroundColor: colours.background,
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: colours.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
