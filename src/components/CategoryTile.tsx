import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { categoryTile, radius } from '../theme/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Icons for common things by name, then by category. */
const BY_NAME: Array<[RegExp, IconName]> = [
  [/hair|barber/i, 'content-cut'],
  [/dent|teeth|tooth/i, 'tooth-outline'],
  [/smoke|alarm/i, 'bell-outline'],
  [/filter|vent|air/i, 'weather-windy'],
  [/car|tyre|tire|oil|rego|service/i, 'car-outline'],
];

const BY_CATEGORY: Record<string, IconName> = {
  Health: 'heart-pulse',
  Household: 'home-outline',
  Auto: 'car-outline',
  Family: 'account-heart-outline',
  Admin: 'file-document-outline',
  Finance: 'cash',
  Purchases: 'shopping-outline',
};

export function iconFor(name: string, category: string): IconName {
  return BY_NAME.find(([re]) => re.test(name))?.[1] ?? BY_CATEGORY[category] ?? 'shape-outline';
}

interface Props {
  name: string;
  category: string;
  size?: number;
}

/** 48×48 tinted tile with a stroke icon for the item. */
export default function CategoryTile({ name, category, size = 48 }: Props) {
  const tile = categoryTile(category);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.tile,
        backgroundColor: tile.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <MaterialCommunityIcons name={iconFor(name, category)} size={Math.round(size * 0.54)} color={tile.icon} />
    </View>
  );
}
