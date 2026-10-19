import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { StatusLabel } from '../types';
import { chipLabel } from '../domain/items/display';
import { statusStyle, type, radius } from '../theme/tokens';

/** Rounded status chip; the text always carries the meaning, not just the colour. */
export default function StatusChip({ label, testID }: { label: StatusLabel | null; testID?: string }) {
  const s = statusStyle(label);
  return (
    <View style={[styles.chip, { backgroundColor: s.chipBg }]} testID={testID}>
      <Text style={[type.chip, { color: s.chipText }]}>{chipLabel(label)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
