import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import { SinceItem } from '../types';
import { computeItemStatus, secondaryLine } from '../utils/statusUtils';
import { colours, statusColour } from './colours';

interface Props {
  item: SinceItem;
  onMarkDone: (item: SinceItem) => void;
  onEdit: (item: SinceItem) => void;
  onDelete: (item: SinceItem) => void;
  /** Opens the item's completion history. Omitted for expiry-mode items. */
  onPress?: (item: SinceItem) => void;
}

export default function ItemCard({ item, onMarkDone, onEdit, onDelete, onPress }: Props) {
  const status = computeItemStatus(item);
  const { label, daysSince } = status;
  const secondary = secondaryLine(status);
  const accent = statusColour(label);

  const translateX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = 80;
  const REVEAL_WIDTH = 130;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dy) < 20,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) {
          translateX.setValue(Math.max(g.dx, -REVEAL_WIDTH));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -SWIPE_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: -REVEAL_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  function closeSwipe() {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  }

  function handleDelete() {
    Alert.alert(
      'Delete item',
      `Remove "${item.name}" from Since?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: closeSwipe },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(item),
        },
      ],
    );
  }

  const sinceText =
    daysSince === 0
      ? 'Done today'
      : daysSince === 1
      ? 'Last done yesterday'
      : `Last done ${daysSince} days ago`;

  return (
    <View style={styles.container}>
      {/* Swipe actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => { closeSwipe(); onEdit(item); }}
          accessibilityLabel={`Edit ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={handleDelete}
          accessibilityLabel={`Delete ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Row */}
      <Animated.View
        style={[styles.row, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {/* Left state indicator */}
        <View style={[styles.accentBar, { backgroundColor: accent }]} />

        <View
          style={styles.content}
          onStartShouldSetResponder={() => false}
        >
          <View style={styles.topRow}>
            {onPress ? (
              <TouchableOpacity
                style={styles.nameWrap}
                onPress={() => onPress(item)}
                accessibilityLabel={`${item.name} history`}
                accessibilityRole="button"
              >
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            )}
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => onMarkDone(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={`Mark ${item.name} done`}
              accessibilityRole="button"
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sinceText}>{sinceText}</Text>

          {label !== null ? (
            <Text style={styles.statusText}>
              <Text style={{ color: accent }}>{label}</Text>
              <Text style={styles.dot}>{'  ·  '}</Text>
              <Text>{secondary}</Text>
            </Text>
          ) : (
            <Text style={styles.statusText}>Tracked only</Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  actionsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    width: 65,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtn: {
    backgroundColor: '#4A4A47',
  },
  deleteBtn: {
    backgroundColor: colours.destructive,
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colours.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colours.border,
  },
  accentBar: {
    width: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 3,
  },
  nameWrap: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colours.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  doneBtn: {
    paddingTop: 1,
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colours.textMuted,
    letterSpacing: 0.1,
  },
  sinceText: {
    fontSize: 13,
    color: colours.textSecondary,
    marginBottom: 5,
  },
  statusText: {
    fontSize: 12,
    color: colours.textMuted,
  },
  dot: {
    color: colours.border,
  },
});
