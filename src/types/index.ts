export type RepeatUnit = 'days' | 'weeks' | 'months' | 'years';

/** A single logged completion. */
export interface CompletionEvent {
  id: string;
  date: string; // ISO date string (YYYY-MM-DD)
}

export interface SinceItem {
  id: string;
  name: string;
  category: string;
  lastDoneDate: string; // ISO date string (YYYY-MM-DD)
  /**
   * Completion log, newest first. When non-empty, history[0].date mirrors
   * lastDoneDate.
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
  'Purchases',
  'Other',
] as const;

// Main app navigation
export type RootStackParamList = {
  Main: undefined;
  Add: undefined;
  Edit: { itemId: string };
  Detail: { itemId: string };
  Account: undefined;
  ChangePassword: undefined;
};

// Auth flow navigation
export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  EnterCode: { email: string; purpose: 'signup' | 'recovery' };
};

// Shown instead of the main app after a recovery code, until the new
// password is saved (auth/recovery.ts)
export type RecoveryStackParamList = {
  SetNewPassword: undefined;
};
