export type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

export interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string; // ISO date string (YYYY-MM-DD)
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  createdAt: string;
  updatedAt: string;
}

export type StatusLabel =
  | 'All good'
  | 'Coming up'
  | 'About now'
  | "It's been a while"
  | 'Getting overdue'
  | 'Long overdue';

export interface ItemStatus {
  label: StatusLabel | null; // null = no repeat interval set
  daysSince: number;
  daysUntilDue: number | null;
  nextDueDate: Date | null;
}

export const DEFAULT_CATEGORIES = [
  'Household',
  'Health',
  'Auto',
  'Family',
  'Admin',
  'Purchases',
  'Other',
] as const;

export type RootStackParamList = {
  Main: undefined;
  Add: undefined;
  Edit: { itemId: string };
};
