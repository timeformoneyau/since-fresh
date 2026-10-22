import { SinceItem, RepeatUnit, ItemStatus } from '../../types';

export interface CreateItemInput {
  name: string;
  category: string;
  lastDoneDate: string;
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  /** Shared with this household; absent or null for just me. */
  householdId?: string | null;
  /** Who looks after it (shared items only); absent or null for Anyone. */
  lookedAfterBy?: string | null;
}

export interface UpdateItemInput {
  name?: string;
  category?: string;
  lastDoneDate?: string;
  repeatValue?: number | null;
  repeatUnit?: RepeatUnit | null;
  /** Who it's for: a household id, or null for just me. Only its creator may change it. */
  householdId?: string | null;
  /** Who looks after it: a member, or null for Anyone. Any member may change it. */
  lookedAfterBy?: string | null;
}

/** A SinceItem with all computed fields attached. Single source of truth for derived state. */
export interface DerivedItem extends SinceItem {
  status: ItemStatus;
  /** YYYY-MM-DD the item's snooze ends, while snoozed on this phone. Never stored. */
  snoozedUntil?: string | null;
}
