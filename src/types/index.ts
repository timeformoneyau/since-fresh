export type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

export type ItemSource = 'manual' | 'photo';

export interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string; // ISO date string (YYYY-MM-DD)
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  // When set, this is the due date directly (e.g. a food expiry date read
  // from a photo) and takes priority over lastDoneDate + repeat interval.
  expiryDate: string | null; // ISO date string (YYYY-MM-DD)
  source: ItemSource;
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
  'Food',
  'Other',
] as const;

/** Prefill passed from ScanFoodScreen into AddItemScreen after a successful scan. */
export interface AddScreenPrefill {
  name: string;
  category: string;
  expiryDate: string | null;
  source: ItemSource;
  lowConfidence: boolean;
}

export type RootStackParamList = {
  Main: undefined;
  Add: { prefill?: AddScreenPrefill } | undefined;
  Edit: { itemId: string };
  ScanFood: undefined;
};
