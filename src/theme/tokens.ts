import type { TextStyle, ViewStyle } from 'react-native';
import type { StatusLabel } from '../types';

/**
 * Design tokens for the Since redesign (docs/SINCE_REDESIGN_BRIEF.md, section 2).
 * Screens use these rather than hard-coded colours, fonts or radii.
 */

export const palette = {
  navy: '#27325C',
  ground: '#EBEDF5',
  card: '#FFFFFF',
  ink: '#1B2140',
  muted: '#566086', // ≥5:1 on ground and white
  ice: '#8FD6F5', // shapes on navy only, never text on light backgrounds
  iceDeep: '#2A7FAE',
  ringPale: '#DCE1F7',
  onNavyMuted: '#C5CCEC',
  doneBg: '#E4E8F7',
  selectedBg: '#E8EBFA',
  iconBtnBg: '#E8EBF6',
  inputBg: '#F2F4FA',
  barTrack: '#EDEFF6',
  line: '#C3C9E3',
  lineHalo: '#D3D8EF',
  border: '#CDD2EA',
  danger: '#8F2323',
  infoBg: '#E6E3F2',
  infoText: '#3A3560',
  amberBg: '#FCEBCB',
  amberText: '#7A4A00',
} as const;

/**
 * Semantic names used across the screens (the old colours.ts keys, now
 * pointing at the new palette).
 */
export const colours = {
  background: palette.ground,
  surface: palette.card,
  border: palette.border,
  textPrimary: palette.ink,
  textSecondary: palette.muted,
  textMuted: palette.muted,
  primary: palette.navy,
  onPrimary: '#FFFFFF',
  destructive: palette.danger,
  separator: palette.border,
} as const;

export interface StatusStyle {
  chipBg: string;
  chipText: string;
  bar: string | null;
}

const statusStyles: Record<StatusLabel, StatusStyle> = {
  'All good': { chipBg: '#DCEDE8', chipText: '#1F5A4F', bar: '#5FA897' },
  'Coming up': { chipBg: '#FCEBCB', chipText: '#7A4A00', bar: '#EDA93A' },
  'About now': { chipBg: '#FCEBCB', chipText: '#7A4A00', bar: '#EDA93A' },
  "It's been a while": { chipBg: '#F9DCCB', chipText: '#8A3A12', bar: '#D9804E' },
  'Getting overdue': { chipBg: '#F6D3D0', chipText: '#8F2323', bar: '#D4605E' },
  'Long overdue': { chipBg: '#EBC5C5', chipText: '#6B1414', bar: '#B33A3A' },
};

const onceOffStyle: StatusStyle = { chipBg: '#E6E3F2', chipText: '#4A4570', bar: null };

/** Chip and bar colours for a status; null (no repeat) is "Once off". */
export function statusStyle(label: StatusLabel | null): StatusStyle {
  return label ? statusStyles[label] : onceOffStyle;
}

/** Bar fill for a status (also used for the history due-marker dot). */
export function statusColour(label: StatusLabel | null): string {
  return statusStyle(label).bar ?? palette.muted;
}

export interface CategoryTile {
  bg: string;
  icon: string;
}

const neutralTile: CategoryTile = { bg: '#F4E8CF', icon: '#7A5A12' };

const categoryTiles: Record<string, CategoryTile> = {
  Health: { bg: '#F8DDDA', icon: '#9B3A45' },
  Household: { bg: '#D7ECF2', icon: '#27325C' },
  Auto: { bg: '#DCE6F7', icon: '#2F4F8F' },
  Family: { bg: '#E6E3F2', icon: '#4A4570' },
};

/** Tile colours for a category; Admin, Finance, Purchases, Other and custom ones share one. */
export function categoryTile(category: string): CategoryTile {
  return categoryTiles[category] ?? neutralTile;
}

/** Font family names, as loaded in App.tsx. Use these instead of fontWeight. */
export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
} as const;

export const type = {
  wordmark: { fontFamily: fonts.serif, fontSize: 36, color: '#FFFFFF' },
  screenTitle: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 44, color: palette.ink },
  sectionHeading: { fontFamily: fonts.serif, fontSize: 27, color: palette.ink },
  cardTitle: { fontFamily: fonts.bold, fontSize: 17, color: palette.ink },
  body: { fontFamily: fonts.semibold, fontSize: 16.5, color: palette.ink },
  secondary: { fontFamily: fonts.regular, fontSize: 13.5, color: palette.muted },
  chip: { fontFamily: fonts.bold, fontSize: 13 },
  button: { fontFamily: fonts.bold, fontSize: 16.5 },
} satisfies Record<string, TextStyle>;

export const radius = {
  card: 22,
  tile: 16,
  button: 18,
  header: 30,
  pill: 999,
} as const;

export const space = {
  screen: 16, // side padding
  cardGap: 12,
  cardPadding: 16,
} as const;

/** Minimum tap target. */
export const TAP = 44;

export const cardShadow: ViewStyle = {
  shadowColor: '#1B2140',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};
