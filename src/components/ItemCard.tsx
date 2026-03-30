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
}

export default function ItemCard({ item, onMarkDone, onEdit, onDelete }: Props) {
  const status = computeItemStatus(item);
  const { label, daysSince } = status;
  const secondary = secondaryLine(status);
  const accent = statusColour(label);

  const translateX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = 80;
  const REVEAL_WIDTH = 130; // width of actions behind

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
      ? "Done today"
      : daysSince === 1
      ? "You haven't done this in 1 day"
      : `You haven't done this in ${daysSince} days`;

  return (
    <View style={styles.container}>
      {/* Swipe action buttons revealed behind */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => { closeSwipe(); onEdit(item); }}
        >
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={handleDelete}
        >
          <Text style={styles.actionText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Main card face */}
      <Animated.View
        style={[styles.card, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {/* Status accent bar */}
        <View style={[styles.accentBar, { backgroundColor: accent }]} />

        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => onMarkDone(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sinceText}>{sinceText}</Text>

          <View style={styles.bottomRow}>
            {label !== null ? (
              <>
                <Text style={[styles.statusLabel, { color: accent }]}>{label}</Text>
                <Text style={[styles.secondaryText, { marginLeft: 6 }]}>{secondary}</Text>
              </>
            ) : (
              <Text style={styles.secondaryText}>Tracked only</Text>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
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
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: colours.surface,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    // subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  accentBar: {
    width: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colours.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  doneBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F0F0EE',
    borderRadius: 6,
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colours.textSecondary,
    letterSpacing: 0.2,
  },
  sinceText: {
    fontSize: 13,
    color: colours.textSecondary,
    marginBottom: 6,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  secondaryText: {
    fontSize: 12,
    color: colours.textMuted,
  },
});
