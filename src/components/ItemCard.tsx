import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
} from 'react-native';
import { SinceItem } from '../types';
import { computeItemStatus, secondaryLine } from '../utils/statusUtils';
import { intervalProgress, lastDoneText } from '../domain/items/display';
import {
  colours,
  palette,
  statusColour,
  fonts,
  type,
  radius,
  space,
  cardShadow,
  TAP,
} from '../theme/tokens';
import CategoryTile from './CategoryTile';
import StatusChip from './StatusChip';
import { isShared } from '../domain/household/rules';

interface Props {
  item: SinceItem;
  onMarkDone: (item: SinceItem) => void;
  onEdit: (item: SinceItem) => void;
  /** Absent when this person can't delete it (someone else's shared item). */
  onDelete?: (item: SinceItem) => void;
  /** Opens the item screen. */
  onPress?: (item: SinceItem) => void;
}

export default function ItemCard({ item, onMarkDone, onEdit, onDelete, onPress }: Props) {
  const status = computeItemStatus(item);
  const { label, daysSince } = status;
  const secondary = secondaryLine(status);

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
    // No confirm dialog: the list offers Undo right after
    closeSwipe();
    onDelete?.(item);
  }

  const progress = intervalProgress(status);
  const once = label === null;

  return (
    <View style={styles.container} testID={`item-${item.name}`}>
      {/* Swipe actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.editBtn]}
          onPress={() => { closeSwipe(); onEdit(item); }}
          testID={`item-${item.name}-edit`}
          accessibilityLabel={`Edit ${item.name}`}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Edit</Text>
        </TouchableOpacity>
        {onDelete && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={handleDelete}
            testID={`item-${item.name}-delete`}
            accessibilityLabel={`Delete ${item.name}`}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.View
        style={[styles.card, { transform: [{ translateX }] }]}
        testID={`item-${item.name}-row`}
        {...panResponder.panHandlers}
      >
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.titleArea}
            onPress={() => onPress?.(item)}
            disabled={!onPress}
            testID={`item-${item.name}-history`}
            accessibilityLabel={`Open ${item.name}`}
            accessibilityRole="button"
          >
            <CategoryTile name={item.name} category={item.category} />
            <View style={styles.titleText}>
              <Text style={type.cardTitle}>{item.name}</Text>
              <View style={styles.metaRow}>
                <Text style={type.secondary}>{lastDoneText(daysSince)}</Text>
                {isShared(item) && (
                  <Text style={styles.householdTag} testID={`item-${item.name}-household-tag`}>Household</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
          {!once && (
            <TouchableOpacity
              style={styles.donePill}
              onPress={() => onMarkDone(item)}
              testID={`item-${item.name}-done`}
              accessibilityLabel={`Mark ${item.name} done`}
              accessibilityRole="button"
            >
              <Text style={styles.donePillText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.statusRow}>
          <StatusChip label={label} />
          <Text style={[type.secondary, styles.statusLine]}>{secondary}</Text>
        </View>

        {progress !== null && (
          <View style={styles.barTrack} testID={`item-${item.name}-bar`}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round(progress * 100)}%`, backgroundColor: statusColour(label) },
              ]}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: space.screen,
    marginBottom: space.cardGap,
    borderRadius: radius.card,
  },
  actionsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  actionBtn: {
    width: 65,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtn: {
    backgroundColor: palette.navy,
  },
  deleteBtn: {
    backgroundColor: colours.destructive,
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: fonts.semibold,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    ...cardShadow,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TAP,
    marginRight: 8,
  },
  titleText: {
    flex: 1,
    marginLeft: 12,
  },
  donePill: {
    minHeight: TAP,
    minWidth: 64,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: palette.doneBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donePillText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: palette.navy,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  householdTag: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: palette.navy,
    backgroundColor: palette.infoBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  statusLine: {
    flexShrink: 1,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.barTrack,
    marginTop: 10,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
});
