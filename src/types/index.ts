export type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

/** A single logged completion (an entry in the item's history). */
export interface CompletionEvent {
  id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  /** Optional note. Added in the redesign; older entries have none. */
  note?: string;
  /** When the entry was recorded. Older entries have none. */
  createdAt?: string;
}

/** The brief's name for a completion event. */
export type HistoryEntry = CompletionEvent;

export interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string; // ISO date string (YYYY-MM-DD)
  /**
   * Completion log, newest first (by date). Never empty for a stored item.
   * lastDoneDate is kept for older builds, and always equals history[0].date
   * after any change (domain/items/history.ts, withHistory).
   */
  history: CompletionEvent[];
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
  'Finance',
  'Purchases',
  'Other',
] as const;

// Main app navigation
export type RootStackParamList = {
  Main: undefined;
  Add: undefined;
  Edit: { itemId: string };
  Detail: { itemId: string };
  EditEntry: { itemId: string; entryId: string };
  Account: undefined;
  // Signing in is optional and starts from Account (email, then a code).
  SignIn: undefined;
  ChangeEmail: undefined;
  // Shared by sign-in and email change (domain/auth/codes.ts).
  EnterCode: { email: string; purpose: 'sign_in' | 'email_change' };
};
