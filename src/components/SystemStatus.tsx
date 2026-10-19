import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DerivedItem } from '../domain/items/types';
import { summaryCounts } from '../domain/items/display';
import { palette, type, radius, space, cardShadow } from '../theme/tokens';

function deriveStatusText(items: DerivedItem[]): string {
  const labels = items.map((i) => i.status.label);

  if (labels.some((l) => l === 'Long overdue' || l === 'Getting overdue')) {
    return 'A few things might need attention.';
  }
  if (labels.some((l) => l === "It's been a while")) {
    return "It's been a while for a couple of things.";
  }
  if (labels.some((l) => l === 'About now' || l === 'Coming up')) {
    return 'Something\'s coming up soon.';
  }
  return 'All good. Nothing needs attention.';
}

interface Props {
  items: DerivedItem[];
}

/** Summary card that overlaps the bottom of the header band. */
export default function SystemStatus({ items }: Props) {
  if (items.length === 0) return null;
  const counts = summaryCounts(items.map((i) => i.status.label));
  return (
    <View style={styles.card} testID="summary-card">
      <View style={styles.tile}>
        <MaterialCommunityIcons name="bell-outline" size={24} color={palette.amberText} />
      </View>
      <View style={styles.text}>
        <Text style={type.body}>{deriveStatusText(items)}</Text>
        {counts !== null && <Text style={type.secondary}>{counts}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.card,
    borderRadius: radius.card,
    padding: space.cardPadding,
    marginHorizontal: space.screen,
    marginBottom: space.cardGap,
    ...cardShadow,
  },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.tile,
    backgroundColor: palette.amberBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  text: {
    flex: 1,
  },
});
