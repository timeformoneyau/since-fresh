import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SinceItem, RootStackParamList } from '../types';
import { loadItems, updateItem, deleteItem } from '../storage/items';
import { sortItems } from '../utils/statusUtils';
import { todayString } from '../utils/dateUtils';
import { scheduleItemNotifications, cancelItemNotifications } from '../notifications/scheduler';
import ItemCard from '../components/ItemCard';
import { colours } from '../components/colours';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;

const QUICK_START = [
  { name: 'Dentist', category: 'Health' },
  { name: 'Tyre rotation', category: 'Auto' },
  { name: 'Air filter', category: 'Household' },
  { name: 'Smoke alarm', category: 'Household' },
];

export default function MainListScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<SinceItem[]>([]);

  const refresh = useCallback(async () => {
    const loaded = await loadItems();
    setItems(sortItems(loaded));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function handleMarkDone(item: SinceItem) {
    const updated: SinceItem = {
      ...item,
      lastDoneDate: todayString(),
      updatedAt: new Date().toISOString(),
    };
    await updateItem(updated);
    await scheduleItemNotifications(updated);
    refresh();
  }

  async function handleDelete(item: SinceItem) {
    await cancelItemNotifications(item.id);
    await deleteItem(item.id);
    refresh();
  }

  function handleEdit(item: SinceItem) {
    navigation.navigate('Edit', { itemId: item.id });
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

          <TouchableOpacity
            style={styles.primaryCTA}
            onPress={() => navigation.navigate('Add')}
          >
            <Text style={styles.primaryCTAText}>Add something</Text>
          </TouchableOpacity>

          <Text style={styles.quickStartLabel}>Quick start</Text>
          <View style={styles.quickStartRow}>
            {QUICK_START.map((q) => (
              <TouchableOpacity
                key={q.name}
                style={styles.chip}
                onPress={() =>
                  navigation.navigate('Add')
                }
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
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('Add')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.addBtnText}>＋</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            onMarkDone={handleMarkDone}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
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
  primaryCTA: {
    backgroundColor: colours.textPrimary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginBottom: 40,
  },
  primaryCTAText: {
    color: '#fff',
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
    paddingTop: 8,
    paddingBottom: 32,
  },
});
