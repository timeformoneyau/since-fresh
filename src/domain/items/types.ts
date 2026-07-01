import { SinceItem, RepeatUnit, ItemStatus, ItemSource } from '../../types';

export interface CreateItemInput {
  name: string;
  category: string;
  lastDoneDate: string;
  repeatValue: number | null;
  repeatUnit: RepeatUnit | null;
  expiryDate?: string | null;
  source?: ItemSource;
}

export interface UpdateItemInput {
  name?: string;
  category?: string;
  lastDoneDate?: string;
  repeatValue?: number | null;
  repeatUnit?: RepeatUnit | null;
  expiryDate?: string | null;
  source?: ItemSource;
}

/** A SinceItem with all computed fields attached. Single source of truth for derived state. */
export interface DerivedItem extends SinceItem {
  status: ItemStatus;
}
