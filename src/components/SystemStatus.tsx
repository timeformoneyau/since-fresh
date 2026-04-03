import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { DerivedItem } from '../domain/items/types';
import { colours } from './colours';

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

export default function SystemStatus({ items }: Props) {
  if (items.length === 0) return null;
  return <Text style={styles.text}>{deriveStatusText(items)}</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontSize: 13,
    color: colours.textMuted,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
});
