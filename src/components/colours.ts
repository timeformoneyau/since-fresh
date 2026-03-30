import { StatusLabel } from '../types';

export const colours = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  border: '#EBEBEA',
  textPrimary: '#111110',
  textSecondary: '#6B6B68',
  textMuted: '#9E9E9A',

  // Status colours
  allGood: '#9E9E9A',         // neutral grey
  comingUp: '#C8842A',        // soft amber
  aboutNow: '#C8842A',
  itsBeenAWhile: '#B85C3A',
  gettingOverdue: '#C0392B',
  longOverdue: '#922B21',

  // UI accents
  primary: '#111110',
  destructive: '#C0392B',
  separator: '#EBEBEA',
} as const;

export function statusColour(label: StatusLabel | null): string {
  switch (label) {
    case 'All good':          return colours.allGood;
    case 'Coming up':         return colours.comingUp;
    case 'About now':         return colours.aboutNow;
    case "It's been a while": return colours.itsBeenAWhile;
    case 'Getting overdue':   return colours.gettingOverdue;
    case 'Long overdue':      return colours.longOverdue;
    case null:                return colours.textMuted;
    default:                  return colours.textMuted;
  }
}
